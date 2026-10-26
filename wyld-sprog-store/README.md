# Wyld Sprog — independent brand store

A standalone direct-to-consumer storefront for Wyld Sprog. It has its own catalog, product imagery, size-level inventory, shopping bag, cash-on-delivery checkout, order storage and password-protected admin panel. The storefront contains **no marketplace links, embeds, fonts, scripts or tracking**.

## What is included

- 90 brand styles in five categories: T-shirts (35), clothing sets (19), night suits (19), sweatshirts (14) and track pants (3).
- Search, category / gender / price / discount / size / colour / availability filters, sorting, saved styles and quick views.
- A persistent browser bag with quantity controls, shipping estimate and an in-page checkout.
- A dependency-free Node.js server that saves cash-on-delivery orders and decrements counted stock.
- `/admin` inventory management, order management, catalog import/export and store settings.
- Local product photos and a brand SVG favicon; no external runtime dependencies.

## Run the store

From this directory:

```sh
npm start
```

Then open `http://localhost:4173/`. The admin panel is at `http://localhost:4173/admin`.

For the Arena live preview, start the same command from this directory. The server binds to `0.0.0.0` and uses relative API URLs, so the proxied preview works without CORS or localhost calls in browser code.

### Admin password

The preview default is:

```text
wyld-sprog-preview
```

Before any public launch, set a strong password in the environment:

```sh
WYLD_ADMIN_PASSWORD='your-long-unique-password' npm start
```

The password is never written into browser code. Admin sessions use an HttpOnly cookie and a custom request header.

## Catalog and inventory scope

`data/catalog.json` is the server's source of truth; `catalog.js` is generated from it for static fallback. The seed catalog has 90 style slots based on a public assortment snapshot. Product names, prices, discounts, listed sizes and category counts reflect that snapshot, but the following still need the brand owner's approved master data before launch:

- original high-resolution photography for every style (the seed uses a small local photo pool);
- complete product descriptions, fabric, care, GST/HSN and variant SKUs;
- all available sizes per style, not only the single listed size in the snapshot;
- real size-level stock counts. `stock: null` means "available, exact count not set" — it is not a verified quantity;
- your final pricing, shipping, returns, tax and support details.

Use `/admin → Inventory` to set stock numbers and availability. Use `/admin → Catalog` to download the current catalog JSON, edit it, and upload the complete approved feed. The importer validates that every product has a SKU, name, category, price, MRP and at least one size. Rebuilding the seed catalog is also possible with `npm run build:catalog`, but importing your feed is the intended path.

## Checkout and orders

The storefront accepts cash-on-delivery orders. The server recalculates every price, validates stock, creates an order ID, decrements counted stock and saves the order to `data/orders.json`. That file is ignored by Git because it contains customer information.

Online card/UPI/net-banking payments are intentionally disabled in this preview. To accept them, integrate a payment gateway on the server: create a payment intent, verify the gateway webhook/signature, then mark the order paid. Never put a payment secret in browser code, and do not treat a client-side success screen as proof of payment.

The file-based order store is suitable for a demo or a very small pilot. For production, move catalog, inventory, orders and sessions to a managed database, add rate limiting, backups, email/SMS notifications, shipping labels, audit logs and a full fraud/abuse review.

## Store settings

`data/settings.json` controls shipping fee, free-shipping threshold, support email, policies and cash-on-delivery availability. Edit it in `/admin → Settings`. Replace `hello@wyldsprog.example` with a real support address before launch.

## Files

- `index.html`, `store.css`, `store.js` — customer storefront.
- `admin.html`, `admin.css`, `admin.js` — brand admin panel.
- `server.js` — static server, order API and admin API.
- `catalog.js`, `data/catalog.json` — generated/store catalog.
- `data/settings.json` — editable store policies and fees.
- `data/orders.json` — runtime order data, ignored by Git.
- `assets/products/` — local product photo pool.
- `tools/build-catalog.py` — regenerates the 90-style seed catalog.
