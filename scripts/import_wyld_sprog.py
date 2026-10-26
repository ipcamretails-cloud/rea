#!/usr/bin/env python3
"""Fetch the public Wyld Sprog assortment and normalize it for the brand store.

This is a one-time import helper. It writes catalog.json plus locally cached
product photos to the output directory. It does not change the storefront.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import pathlib
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://www.myntra.com/wyld-sprog"
CATEGORIES = [
    ("T-shirts", "Tshirts"),
    ("Clothing sets", "Clothing Set"),
    ("Night suits", "Night suits"),
    ("Sweatshirts", "Sweatshirts"),
    ("Track pants", "Track Pants"),
]
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.myntra.com/",
    "Connection": "close",
}
IMAGE_HEADERS = {**HEADERS, "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"}
RATE_LIMIT = threading.Semaphore(4)
RATE_LOCK = threading.Lock()
LAST_REQUEST = [0.0]


def polite_wait() -> None:
    with RATE_LOCK:
        delta = time.monotonic() - LAST_REQUEST[0]
        if delta < 0.12:
            time.sleep(0.12 - delta)
        LAST_REQUEST[0] = time.monotonic()


def fetch(url: str, *, binary: bool = False, tries: int = 3) -> bytes | str:
    last_error: Exception | None = None
    for attempt in range(tries):
        try:
            polite_wait()
            request = urllib.request.Request(url, headers=IMAGE_HEADERS if binary else HEADERS)
            with urllib.request.urlopen(request, timeout=35) as response:
                data = response.read()
            if not data:
                raise ValueError("empty response")
            return data if binary else data.decode("utf-8", "replace")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as error:
            last_error = error
            if attempt + 1 < tries:
                time.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def extract_myx(html: str) -> dict:
    decoder = json.JSONDecoder()
    for match in re.finditer(r"window\.__myx\s*=\s*", html):
        try:
            data, _ = decoder.raw_decode(html[match.end():])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            continue
    raise ValueError("no window.__myx JSON found")


def listing_url(facet: str) -> str:
    query = urllib.parse.urlencode({
        "sort": "price_desc",
        "rawQuery": "wyld sprog",
        "f": f"Categories:{facet}",
    })
    return f"{BASE}?{query}"


def product_url(landing_page_url: str) -> str:
    landing = (landing_page_url or "").lstrip("/")
    if landing.startswith("http://"):
        landing = "https://" + landing[len("http://"):]
    if landing.startswith("https://"):
        return landing
    url = "https://www.myntra.com/" + landing
    if not url.rstrip("/").endswith("/buy"):
        url = url.rstrip("/") + "/buy"
    return url


def compact(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def stock_count(node: dict) -> int | None:
    counts: list[int] = []
    for source in [node, *(node.get("sizeSellerData") or [])]:
        if not isinstance(source, dict):
            continue
        for key in ("availableCount", "available_count", "inventory", "stock", "quantity"):
            value = source.get(key)
            if isinstance(value, int) and value >= 0:
                counts.append(value)
            elif isinstance(value, str) and value.isdigit():
                counts.append(int(value))
    return max(counts) if counts else None


def pdp_inventory(product: dict) -> tuple[list[dict], str | None]:
    url = product_url(product.get("landingPageUrl"))
    try:
        data = extract_myx(fetch(url))
        pdp = data.get("pdpData") or {}
        sizes = []
        for row in pdp.get("sizes") or []:
            if not isinstance(row, dict):
                continue
            label = compact(row.get("label") or row.get("size") or row.get("sizeValue"))
            if not label:
                continue
            sizes.append({
                "size": label,
                "sku": str(row.get("skuId") or row.get("styleId") or label),
                "available": bool(row.get("available")),
                "stock": stock_count(row) if row.get("available") else 0,
            })
        if sizes:
            return sizes, None
        return [], "no sizes in product page"
    except Exception as error:  # keep the import going; report missing pages
        return [], str(error)


def fallback_inventory(product: dict) -> tuple[list[dict], str]:
    rows = product.get("sizes") or product.get("inventoryInfo") or []
    if isinstance(rows, str):
        labels = [compact(part) for part in rows.split(",") if compact(part)]
        return [
            {"size": label, "sku": label, "available": True, "stock": None}
            for label in labels
        ], "listing size labels only"
    sizes = []
    for row in rows:
        if isinstance(row, dict):
            label = compact(row.get("label") or row.get("size") or row.get("sizeValue"))
            if not label:
                continue
            sizes.append({
                "size": label,
                "sku": str(row.get("skuId") or row.get("styleId") or label),
                "available": bool(row.get("available", True)),
                "stock": stock_count(row),
            })
        elif compact(row):
            label = compact(row)
            sizes.append({"size": label, "sku": label, "available": True, "stock": None})
    return sizes, "listing inventory fallback"


def image_extension(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:2] == b"\xff\xd8":
        return ".jpg"
    if b"ftypavif" in data[:32]:
        return ".avif"
    return ".jpg"


def normalize_image_url(raw: str) -> str | None:
    url = compact(raw)
    if not url:
        return None
    if url.startswith("//"):
        url = "https:" + url
    elif url.startswith("http://"):
        url = "https://" + url[len("http://"):]
    elif url.startswith("/"):
        url = "https://www.myntra.com" + url
    url = re.sub(
        r"/dpr_2,q_60,w_210,c_limit,fl_progressive/",
        "/dpr_2,q_78,w_600,c_limit,fl_progressive/",
        url,
    )
    return url


def download_image(product: dict, out_dir: pathlib.Path) -> tuple[str | None, str | None]:
    raw = product.get("searchImage")
    images = product.get("images") or []
    if not raw and isinstance(images, list) and images:
        first = images[0]
        raw = first.get("imageURL") if isinstance(first, dict) else first
    url = normalize_image_url(raw or "")
    if not url:
        return None, "no image URL"
    try:
        data = fetch(url, binary=True, tries=2)
        extension = image_extension(data)
        name = f"style-{compact(product.get('productId'))}{extension}"
        (out_dir / name).write_bytes(data)
        return f"assets/catalog/{name}", None
    except Exception as error:
        return None, str(error)


def clean_name(product: dict) -> str:
    brand = compact(product.get("brand"))
    name = compact(product.get("productName") or product.get("product"))
    if brand and name.lower().startswith(brand.lower() + " "):
        name = name[len(brand) + 1:].strip()
    colour = compact(product.get("primaryColour"))
    if colour and colour.lower() not in name.lower():
        name = f"{name} — {colour.title()}"
    return name or "Wyld Sprog style"


def rating_value(product: dict) -> tuple[float | None, int]:
    try:
        rating = float(product.get("rating") or 0) or None
    except (TypeError, ValueError):
        rating = None
    try:
        reviews = int(product.get("ratingCount") or 0)
    except (TypeError, ValueError):
        reviews = 0
    return rating, reviews


def enrich(item: tuple[int, dict, str], out_dir: pathlib.Path) -> dict:
    index, product, category = item
    sizes, inventory_note = pdp_inventory(product)
    if not sizes:
        fallback, fallback_note = fallback_inventory(product)
        sizes = fallback
        inventory_note = f"{inventory_note or 'PDP unavailable'}; {fallback_note}"
    image, image_error = download_image(product, out_dir)
    price = int(float(product.get("price") or product.get("mrp") or 0))
    mrp = int(float(product.get("mrp") or price or 0))
    discount = int(float(product.get("discount") or 0))
    if not discount and mrp:
        discount = round((1 - price / mrp) * 100)
    rating, reviews = rating_value(product)
    gender = compact(product.get("gender") or "Unisex")
    colour = compact(product.get("primaryColour"))
    return {
        "index": index,
        "sku": f"WS-{index:03d}",
        "name": clean_name(product),
        "gender": gender,
        "category": category,
        "color": colour.title() if colour else "",
        "articleType": compact(product.get("articleType")),
        "price": price,
        "mrp": mrp,
        "discount": discount,
        "rating": rating,
        "reviews": reviews,
        "tag": compact(product.get("productType") or product.get("articleType") or category).upper(),
        "image": image,
        "sizes": sizes,
        "inventorySource": inventory_note,
        "imageError": image_error,
        "sourceKeys": sorted(product.keys()),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="wyld-import", type=pathlib.Path)
    parser.add_argument("--limit", default=0, type=int, help="Limit enriched products for a smoke test")
    args = parser.parse_args()
    out_dir = args.out
    image_dir = out_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)

    diagnostics: dict = {"categories": {}, "errors": []}
    all_products: list[tuple[int, dict, str]] = []
    for category, facet in CATEGORIES:
        url = listing_url(facet)
        try:
            html = fetch(url)
            data = extract_myx(html)
            products = data["searchData"]["results"]["products"]
            diagnostics["categories"][category] = {
                "facet": facet,
                "expected": (data["searchData"]["results"].get("totalCount") or len(products)),
                "fetched": len(products),
                "firstKeys": sorted(products[0].keys()) if products else [],
            }
            print(f"{category}: fetched {len(products)} products", flush=True)
            all_products.extend((len(all_products) + i + 1, product, category) for i, product in enumerate(products))
        except Exception as error:
            diagnostics["errors"].append(f"{category}: {error}")
            print(f"ERROR {category}: {error}", file=sys.stderr, flush=True)

    if args.limit:
        all_products = all_products[:args.limit]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(enrich, item, image_dir) for item in all_products]
        results = []
        for future in concurrent.futures.as_completed(futures):
            try:
                results.append(future.result())
            except Exception as error:
                diagnostics["errors"].append(f"enrich: {error}")
    results.sort(key=lambda row: row["index"])

    diagnostics["products"] = len(results)
    diagnostics["images"] = sum(1 for row in results if row["image"])
    diagnostics["sizeLevelInventory"] = sum(1 for row in results if any(size.get("stock") is not None for size in row["sizes"]))
    diagnostics["availableSizes"] = sum(1 for row in results for size in row["sizes"] if size.get("available"))
    diagnostics["inventoryNotes"] = sorted({row["inventorySource"] for row in results if row["inventorySource"]})
    (out_dir / "catalog.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    (out_dir / "report.json").write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(diagnostics, indent=2), flush=True)
    return 0 if len(results) >= 80 or args.limit else 1


if __name__ == "__main__":
    raise SystemExit(main())
