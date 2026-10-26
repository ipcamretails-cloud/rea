#!/usr/bin/env python3
"""Build the brand-owned Wyld Sprog storefront catalog.

The seed rows describe 90 style slots from the brand's public assortment
snapshot. Replace this file with the owner's approved SKU feed when the
real product photos, descriptions, prices and size-level stock are ready.
No external storefront URLs are written into the site.
"""
from __future__ import annotations

import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]

# category | style reference | descriptive slug | listed size | price | mrp | discount %
SEED = """
T-shirts|30134025|wyld-sprog-women-unicorn-printed-pure-cotton-t-shirt|XL|358|1199|70
T-shirts|29956117|wyld-sprog-women-typography-printed-pure-cotton-t-shirt|XL|358|1199|70
T-shirts|29956116|wyld-sprog-women-graphic-printed-pure-cotton-t-shirt|M|358|1199|70
T-shirts|29956115|wyld-sprog-women-graphic-printed-pure-cotton-t-shirt|M|358|1199|70
T-shirts|29956114|wyld-sprog-women-graphic-printed-pure-cotton-t-shirt|M|358|1199|70
T-shirts|29956113|wyld-sprog-women-graphic-printed-pure-cotton-t-shirt|L|358|1199|70
T-shirts|29393282|wyld-sprog-round-neck-printed-pure-cotton-t-shirt|L|358|1199|70
T-shirts|29393280|wyld-sprog-graphic-printed-pure-cotton-regular-fit-t-shirt|M|358|1199|70
T-shirts|29393276|wyld-sprog-typography-printed-pure-cotton-regular-fit-t-shirt|L|358|1199|70
T-shirts|29393274|wyld-sprog-graphic-printed-pure-cotton-regular-fit-t-shirt|M|358|1199|70
T-shirts|29392988|wyld-sprog-round-neck-printed-pure-cotton-t-shirt|M|358|1199|70
T-shirts|29392986|wyld-sprog-printed-pure-cotton-t-shirt|L|358|1199|70
T-shirts|29392984|wyld-sprog-graphic-printed-pure-cotton-t-shirt|M|358|1199|70
T-shirts|28916448|wyld-sprog-women-printed-pure-cotton-t-shirt|M|358|1199|70
T-shirts|23912824|wyld-sprog-graphic-printed-pure-cotton-casual-t-shirt|M|358|1199|70
T-shirts|23473368|wyld-sprog-graphic-printed-pure-cotton-t-shirt|L|358|1199|70
T-shirts|23473364|wyld-sprog-graphic-printed-pure-cotton-t-shirt|M|358|1199|70
T-shirts|29956118|wyld-sprog-men-graphic-printed-pure-cotton-t-shirt|XXL|336|1199|72
T-shirts|27750556|wyld-sprog-graphic-printed-round-neck-short-sleeves-pure-cotton-t-shirt|L|336|1199|72
T-shirts|25167362|wyld-sprog-graphic-printed-pure-cotton-t-shirt|XXL|336|1199|72
T-shirts|25167358|wyld-sprog-graphic-printed-pure-cotton-t-shirt|M|336|1199|72
T-shirts|24298428|wyld-sprog-graphic-printed-pure-cotton-t-shirt|XXL|336|1199|72
T-shirts|24298422|wyld-sprog-men-graphic-printed-pure-cotton-t-shirt|M|336|1199|72
T-shirts|23589340|wyld-sprog-brand-logo-pure-cotton-regular-fit-t-shirt|M|321|999|68
T-shirts|23589354|wyld-sprog-brand-logo-pure-cotton-regular-fit-t-shirt|XL|303|999|70
T-shirts|23589350|wyld-sprog-brand-logo-pure-cotton-regular-fit-t-shirt|M|303|999|70
T-shirts|23589348|wyld-sprog-brand-logo-pure-cotton-regular-fit-t-shirt|XL|303|999|70
T-shirts|23589344|wyld-sprog-pure-cotton-knitted-t-shirt|M|303|999|70
T-shirts|23589342|wyld-sprog-pure-cotton-knitted-t-shirt|M|303|999|70
T-shirts|23589338|wyld-sprog-pure-cotton-knitted-t-shirt|M|303|999|70
T-shirts|23589384|wyld-sprog-brand-logo-pure-cotton-regular-fit-t-shirt|XXL|294|999|71
T-shirts|23589382|wyld-sprog-pure-cotton-knitted-t-shirt|M|294|999|71
T-shirts|23589380|wyld-sprog-brand-logo-pure-cotton-regular-fit-t-shirt|XXL|294|999|71
T-shirts|23589376|wyld-sprog-pure-cotton-knitted-t-shirt|XXL|294|999|71
T-shirts|23589374|wyld-sprog-pure-cotton-knitted-t-shirt|M|294|999|71
Clothing sets|17564432|wyld-sprog-boys-red--blue-graphic-printed-pure-cotton-t-shirt-shorts-clothing-set|3-4Y|380|1599|76
Clothing sets|17564430|wyld-sprog-boys-red--white-printed-t-shirt-with-shorts|2-3Y|380|1599|76
Clothing sets|15722428|wyld-sprog-boys-grey--black-printed-t-shirt-with-shorts|5-6Y|380|1599|76
Clothing sets|15708832|wyld-sprog-boys-green--black-printed-t-shirt-with-shorts|7-8Y|380|1599|76
Clothing sets|15708830|wyld-sprog-boys-blue--black-printed-t-shirt-with-shorts|4-5Y|380|1599|76
Clothing sets|15708828|wyld-sprog-boys-yellow--black-printed-t-shirt-with-shorts|7-8Y|380|1599|76
Clothing sets|15708824|wyld-sprog-boys-blue--black-printed-t-shirt-with-shorts|2-3Y|380|1599|76
Clothing sets|15708822|wyld-sprog-boys-peach--black-bunny-printed-pure-cotton-t-shirt-with-shorts|6-7Y|380|1599|76
Clothing sets|15677326|wyld-sprog-boys-yellow--grey-bunny-printed-cotton-t-shirt-with-shorts|5-6Y|380|1599|76
Clothing sets|15677324|wyld-sprog-boys-orange--black-giraffe-printed-cotton-t-shirt-with-shorts|5-6Y|380|1599|76
Clothing sets|15677316|wyld-sprog-boys-yellow--black-dino-printed-cotton-t-shirt-with-shorts|7-8Y|380|1599|76
Clothing sets|17564436|wyld-sprog-girls-navy-blue--turquoise-blue-printed-t-shirt-with-shorts|2-3Y|309|1599|81
Clothing sets|17564434|wyld-sprog-girls-sea-green--beige-printed-t-shirt-with-shorts|6-7Y|309|1599|81
Clothing sets|17564428|wyld-sprog-girls-purple--white-printed-pure-cotton-t-shirt-with-shorts|2-3Y|309|1599|81
Clothing sets|17564426|wyld-sprog-girls-sea-green--pink-printed-pure-cotton-t-shirt-with-shorts|2-3Y|309|1599|81
Clothing sets|15708826|wyld-sprog-girls-sea-green--red-printed-t-shirt-with-shorts|7-8Y|309|1599|81
Clothing sets|15677344|wyld-sprog-girls-white--black-bunny-face-printed-cotton-t-shirt-with-shorts|7-8Y|309|1599|81
Clothing sets|15677320|wyld-sprog-girls-pink--grey-melange-meowcorn-printed-cotton-t-shirt-with-shorts|5-6Y|309|1599|81
Clothing sets|15677314|wyld-sprog-girls-white--black-mermaid-printed-cotton-t-shirt-with-shorts|2-3Y|309|1599|81
Night suits|23336804|wyld-sprog-kids-animal-printed-pure-cotton-night-suit|2-3Y|346|1599|78
Night suits|21056580|wyld-sprog-kids-printed-night-suit|2-3Y|346|1599|78
Night suits|21056578|wyld-sprog-unisex-kids-printed-night-suit|2-3Y|346|1599|78
Night suits|21056574|wyld-sprog-kids-printed-night-suit|2-3Y|346|1599|78
Night suits|20665834|wyld-sprog-kids-white--black-printed-night-suit|2-3Y|346|1599|78
Night suits|20665832|wyld-sprog-girls-pink--green-printed-night-suit|2-3Y|346|1599|78
Night suits|20665830|wyld-sprog-boys-orange--black-printed-night-suit|2-3Y|346|1599|78
Night suits|20665824|wyld-sprog-kids-rose--blue-printed-night-suit|2-3Y|346|1599|78
Night suits|18443880|wyld-sprog-boys-blue--black-printed-night-suit|2-3Y|346|1599|78
Night suits|17299694|wyld-sprog-boys-orange--black-printed-pure-cotton-night-suit|2-3Y|346|1599|78
Night suits|15908004|wyld-sprog-boys-yellow--white-printed-night-suit|2-3Y|346|1599|78
Night suits|15907998|wyld-sprog-boys-turquoise-blue--yellow-printed-night-suit|2-3Y|346|1599|78
Night suits|15907996|wyld-sprog-girls-teal--blue-printed-night-suit|2-3Y|346|1599|78
Night suits|15907994|wyld-sprog-boys-red--yellow-printed-night-suit|4-5Y|346|1599|78
Night suits|15677338|wyld-sprog-boys-orange--black-lazy-panda-printed-cotton-night-suit|2-3Y|346|1599|78
Night suits|15677336|wyld-sprog-boys-grey--black-owl-printed-cotton-night-suit|2-3Y|346|1599|78
Night suits|15677334|wyld-sprog-girls-grey--black-sleeping-kitty-printed-cotton-night-suit|2-3Y|346|1599|78
Night suits|15677322|wyld-sprog-boys-white--black-monkey-printed-cotton-night-suit|6-7Y|346|1599|78
Night suits|18443888|wyld-sprog-boys-red--grey-printed-night-suit|2-3Y|325|1599|80
Sweatshirts|32133065|wyld-sprog-girls-pack-of-2-printed-sweatshirt|3-4Y|846|3198|74
Sweatshirts|32133064|wyld-sprog-boys-pack-of-2-printed-sweatshirt|4-5Y|846|3198|74
Sweatshirts|32133063|wyld-sprog-girls-pack-of-2-abstract-printed-hooded-pure-cotton-sweatshirt|3-4Y|846|3198|74
Sweatshirts|20008506|wyld-sprog-girls-fluorescent-green-printed-sweatshirt|6-7Y|349|1599|78
Sweatshirts|20008504|wyld-sprog-girls-multicoloured-printed-hooded-sweatshirt|7-8Y|349|1599|78
Sweatshirts|20008502|wyld-sprog-girls-multicoloured-printed-hooded-sweatshirt|3-4Y|349|1599|78
Sweatshirts|19999780|wyld-sprog-boys-blue-printed-sweatshirt|3-4Y|349|1599|78
Sweatshirts|19999778|wyld-sprog-girls-pink-printed-sweatshirt|6-7Y|349|1599|78
Sweatshirts|15908008|wyld-sprog-girls-purple-printed-sweatshirt|2-3Y|349|1599|78
Sweatshirts|15908006|wyld-sprog-girls-red-printed-sweatshirt|2-3Y|349|1599|78
Sweatshirts|15907992|wyld-sprog-boys-navy-blue-printed-sweatshirt|3-4Y|349|1599|78
Sweatshirts|15664230|wyld-sprog-girls-navy-blue--white-cute-kitty-print-sweatshirt|2-3Y|349|1599|78
Sweatshirts|15510514|wyld-sprog-boys-yellow-printed-sweatshirt|2-3Y|349|1599|78
Sweatshirts|15510506|wyld-sprog-girls-yellow--red-printed-sweatshirt|6-7Y|349|1599|78
Track pants|32133107|wyld-sprog-girls-pack-of-2-printed-cotton-joggers|3-4Y|846|2998|72
Track pants|20666960|wyld-sprog-girls-black-graphic-printed-cotton-joggers|5-6Y|376|1499|75
Track pants|20666958|wyld-sprog-girls-navy-blue-graphic-printed-cotton-joggers|2-3Y|376|1499|75
""".strip()

CATEGORY_CODES = {
    "T-shirts": "TS",
    "Clothing sets": "CS",
    "Night suits": "NS",
    "Sweatshirts": "SW",
    "Track pants": "TP",
}
CATEGORY_TAGS = {
    "T-shirts": "COTTON TEE",
    "Clothing sets": "PLAY SET",
    "Night suits": "BEDTIME",
    "Sweatshirts": "LAYER UP",
    "Track pants": "EASY MOVE",
}
IMAGE_POOLS = {
    "T-shirts": ["p16.jpg", "p17.jpg", "p18.jpg"],
    "Clothing sets": ["p03.jpg", "p04.jpg", "p05.jpg", "p06.jpg", "p07.jpg", "p08.jpg", "p09.jpg", "p10.jpg", "p11.jpg", "p12.jpg", "p13.jpg", "p14.jpg"],
    "Night suits": ["p15.jpg", "p01.jpg", "p02.jpg", "p13.jpg", "p14.jpg"],
    "Sweatshirts": ["p01.jpg", "p02.jpg", "p03.jpg", "p04.jpg", "p05.jpg"],
    "Track pants": ["p02.jpg", "p07.jpg", "p11.jpg"],
}
COLORS = [
    "red", "blue", "navy blue", "turquoise blue", "sea green", "green", "yellow", "orange",
    "pink", "purple", "grey", "white", "black", "peach", "rose", "teal", "multicoloured",
    "fluorescent green", "beige", "melange", "maroon", "coral", "lime green", "rust",
]
COLOR_LABEL = {
    "navy blue": "Navy Blue", "turquoise blue": "Turquoise Blue", "sea green": "Sea Green",
    "fluorescent green": "Fluorescent Green", "lime green": "Lime Green", "melange": "Melange",
}


def title_from_slug(slug: str) -> str:
    text = re.sub(r"^wyld-sprog-", "", slug)
    text = text.replace("--", " & ")
    text = re.sub(r"\bprinted\s+printed\b", "printed", text)
    text = text.replace("tshirt", "t-shirt").replace("t-shirt-shirt", "t-shirt")
    text = text.replace("-", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace(" & ", " & ")
    words = []
    for word in text.split(" "):
        if word in {"t-shirt", "tshirt"}:
            words.append("T-shirt")
        elif word == "2pcs":
            words.append("2-Piece")
        elif word.isupper() or word.isdigit():
            words.append(word)
        else:
            words.append(word.capitalize())
    result = " ".join(words)
    result = re.sub(r"\bT Shirt\b", "T-shirt", result)
    return result[0].upper() + result[1:] if result else "Wyld Sprog style"


def color_from_slug(slug: str) -> str:
    normalized = slug.replace("-", " ")
    for color in sorted(COLORS, key=len, reverse=True):
        if re.search(rf"\b{re.escape(color)}\b", normalized):
            return COLOR_LABEL.get(color, color.title())
    return "Assorted"


def gender_from_slug(slug: str) -> str:
    if "women" in slug:
        return "Women"
    if "men" in slug:
        return "Men"
    if "girls" in slug:
        return "Girls"
    if "boys" in slug:
        return "Boys"
    return "Unisex"


CATEGORY_PHRASE = {
    "T-shirts": "cotton tee",
    "Clothing sets": "tee-and-shorts set",
    "Night suits": "night suit",
    "Sweatshirts": "sweatshirt",
    "Track pants": "joggers",
}


def description(category: str, color: str) -> str:
    color_phrase = color.lower() if color != "Assorted" else "playful"
    return (
        f"A {color_phrase} Wyld Sprog {CATEGORY_PHRASE[category]} made for big imaginations "
        "and everyday play. Soft, easy to wear, and ready for whatever comes next."
    )


def build() -> list[dict]:
    counters = {key: 0 for key in CATEGORY_CODES}
    products: list[dict] = []
    for line in SEED.splitlines():
        category, style_ref, slug, size, price, mrp, discount = line.split("|")
        counters[category] += 1
        index = counters[category]
        sku = f"WS-{CATEGORY_CODES[category]}-{index:03d}"
        pool = IMAGE_POOLS[category]
        image = f"assets/products/{pool[(index - 1) % len(pool)]}"
        color = color_from_slug(slug)
        name = title_from_slug(slug)
        if category == "T-shirts":
            name = f"{name} · {size}"
        products.append({
            "sku": sku,
            "styleRef": style_ref,
            "name": name,
            "gender": gender_from_slug(slug),
            "category": category,
            "color": color,
            "price": int(price),
            "mrp": int(mrp),
            "discount": int(discount),
            "rating": None,
            "reviews": 0,
            "tag": CATEGORY_TAGS[category],
            "image": image,
            "description": description(category, color),
            "sizes": [{
                "size": size,
                "sku": f"{sku}-{size}",
                "available": True,
                "stock": None,
            }],
        })
    assert len(products) == 90, len(products)
    assert counters == {
        "T-shirts": 35,
        "Clothing sets": 19,
        "Night suits": 19,
        "Sweatshirts": 14,
        "Track pants": 3,
    }, counters
    return products


def main() -> None:
    products = build()
    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    (data_dir / "catalog.json").write_text(json.dumps(products, ensure_ascii=False, indent=2) + "\n")
    (ROOT / "catalog.js").write_text(
        "/* Generated from data/catalog.json by tools/build-catalog.py. */\n"
        f"window.WYLD_PRODUCTS = {json.dumps(products, ensure_ascii=False, indent=2)};\n"
    )
    print(f"Wrote {len(products)} products to data/catalog.json and catalog.js")


if __name__ == "__main__":
    main()
