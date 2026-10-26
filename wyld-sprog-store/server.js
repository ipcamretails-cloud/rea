#!/usr/bin/env node
'use strict';

// A dependency-free store server for the Wyld Sprog brand storefront.
// It serves the site, keeps catalog/order data in local JSON files, and exposes
// a small password-protected admin API. Replace the file storage and COD-only
// checkout with production services before a public launch.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CATALOG_JS_FILE = path.join(ROOT, 'catalog.js');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.WYLD_ADMIN_PASSWORD || 'wyld-sprog-preview';
const BODY_LIMIT = 2 * 1024 * 1024;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const ORDER_STATUSES = new Set(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);

const DEFAULT_SETTINGS = {
  storeName: 'Wyld Sprog',
  currency: 'INR',
  shippingFee: 49,
  freeShippingThreshold: 999,
  shippingPolicy: 'Dispatch in 1–2 business days. Delivery usually takes 3–7 business days.',
  returnPolicy: '7-day easy returns on unused, unwashed items with tags attached.',
  supportEmail: 'hello@wyldsprog.example',
  codEnabled: true,
  upiEnabled: false,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}

function writeCatalogJs(products) {
  const body = JSON.stringify(products, null, 2);
  const temp = `${CATALOG_JS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `/* Generated from data/catalog.json. */\nwindow.WYLD_PRODUCTS = ${body};\n`);
  fs.renameSync(temp, CATALOG_JS_FILE);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
let catalog = readJson(CATALOG_FILE, []);
let orders = readJson(ORDERS_FILE, []);
let settings = { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
if (!fs.existsSync(CATALOG_FILE)) writeJsonAtomic(CATALOG_FILE, catalog);
if (!fs.existsSync(ORDERS_FILE)) writeJsonAtomic(ORDERS_FILE, orders);
if (!fs.existsSync(SETTINGS_FILE)) writeJsonAtomic(SETTINGS_FILE, settings);

const sessions = new Map();
const loginAttempts = new Map();
let writeChain = Promise.resolve();

function withWrite(work) {
  const result = writeChain.then(work);
  writeChain = result.catch(() => {});
  return result;
}

function baseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'");
}

function sendJson(res, status, value, extraHeaders = {}) {
  baseHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(value));
}

function sendText(res, status, text, headers = {}) {
  baseHeaders(res);
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function publicSettings() {
  return { ...settings };
}

function findProduct(sku) {
  return catalog.find(product => product.sku === sku);
}

function findVariant(product, size) {
  return product?.sizes?.find(variant => variant.size === size);
}

function validateCustomer(customer) {
  const clean = {};
  const fields = [
    ['name', 80], ['phone', 16], ['email', 120], ['address', 300], ['city', 80], ['pin', 6],
  ];
  for (const [key, max] of fields) {
    const value = String(customer?.[key] || '').trim();
    if (!value || value.length > max) throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
    clean[key] = value;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw Object.assign(new Error('Invalid email'), { status: 400 });
  if (!/^[0-9+() -]{8,16}$/.test(clean.phone)) throw Object.assign(new Error('Invalid phone'), { status: 400 });
  if (!/^\d{6}$/.test(clean.pin)) throw Object.assign(new Error('Invalid PIN code'), { status: 400 });
  return clean;
}

function calculateOrder(input) {
  const customer = validateCustomer(input.customer);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) {
    throw Object.assign(new Error('Your bag is empty'), { status: 400 });
  }
  if (input.paymentMethod !== 'cod' || !settings.codEnabled) {
    throw Object.assign(new Error('This payment method is not available'), { status: 400 });
  }
  const items = [];
  for (const requested of input.items) {
    const sku = String(requested?.sku || '');
    const size = String(requested?.size || '');
    const qty = Number(requested?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw Object.assign(new Error('Invalid quantity'), { status: 400 });
    }
    const product = findProduct(sku);
    const variant = findVariant(product, size);
    if (!product || !variant) throw Object.assign(new Error(`Product ${sku} was not found`), { status: 409 });
    if (variant.available === false || (Number.isFinite(variant.stock) && variant.stock < qty)) {
      throw Object.assign(new Error(`${product.name} (${size}) is no longer available`), { status: 409 });
    }
    const existing = items.find(item => item.sku === sku && item.size === size);
    if (existing) {
      existing.qty += qty;
      existing.lineTotal = existing.qty * existing.price;
    } else {
      items.push({
        sku, size, qty, name: product.name, image: product.image,
        price: Number(product.price), lineTotal: Number(product.price) * qty,
      });
    }
  }
  const subtotal = items.reduce((total, item) => total + item.lineTotal, 0);
  const shipping = subtotal >= settings.freeShippingThreshold ? 0 : Number(settings.shippingFee) || 0;
  const total = subtotal + shipping;
  return { customer, items, subtotal, shipping, total };
}

function newOrderNumber() {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('');
  return `WS-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function placeOrder(input) {
  return withWrite(async () => {
    const calculation = calculateOrder(input);
    const order = {
      id: crypto.randomUUID(),
      number: newOrderNumber(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      paymentMethod: 'cod',
      paymentStatus: 'pay-on-delivery',
      customer: calculation.customer,
      items: calculation.items,
      subtotal: calculation.subtotal,
      shipping: calculation.shipping,
      total: calculation.total,
    };
    const nextCatalog = structuredClone(catalog);
    for (const item of order.items) {
      const product = nextCatalog.find(entry => entry.sku === item.sku);
      const variant = findVariant(product, item.size);
      if (!variant) throw Object.assign(new Error('Stock changed while placing the order'), { status: 409 });
      if (variant.available === false || (Number.isFinite(variant.stock) && variant.stock < item.qty)) {
        throw Object.assign(new Error(`${item.name} (${item.size}) is no longer available`), { status: 409 });
      }
      if (Number.isFinite(variant.stock)) variant.stock -= item.qty;
      if (variant.stock === 0) variant.available = false;
    }
    const nextOrders = [order, ...orders];
    writeJsonAtomic(CATALOG_FILE, nextCatalog);
    writeJsonAtomic(ORDERS_FILE, nextOrders);
    writeCatalogJs(nextCatalog);
    catalog = nextCatalog;
    orders = nextOrders;
    return order;
  });
}

function parseCookies(req) {
  return (req.headers.cookie || '').split(';').reduce((result, part) => {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    return result;
  }, {});
}

function isAdmin(req) {
  if (req.headers['x-wyld-admin'] !== '1') return false;
  const token = parseCookies(req).wyld_admin;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  session.expires = Date.now() + SESSION_TTL;
  return true;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendJson(res, 401, { error: 'Admin sign-in required' });
  return false;
}

function validateImportedProducts(products) {
  if (!Array.isArray(products) || !products.length || products.length > 5000) {
    throw Object.assign(new Error('Catalog must contain between 1 and 5000 products'), { status: 400 });
  }
  const seen = new Set();
  return products.map((product, index) => {
    if (!product || typeof product.sku !== 'string' || typeof product.name !== 'string' ||
        typeof product.category !== 'string' || !Number.isFinite(Number(product.price)) ||
        !Number.isFinite(Number(product.mrp)) || !Array.isArray(product.sizes) || !product.sizes.length) {
      throw Object.assign(new Error(`Product ${index + 1} is missing required fields`), { status: 400 });
    }
    const sku = product.sku.trim();
    if (seen.has(sku)) throw Object.assign(new Error(`Duplicate SKU ${sku}`), { status: 400 });
    seen.add(sku);
    const sizes = product.sizes.map(variant => {
      if (!variant || typeof variant.size !== 'string') {
        throw Object.assign(new Error(`Invalid size for ${sku}`), { status: 400 });
      }
      const stock = variant.stock == null ? null : Number(variant.stock);
      return {
        size: variant.size.trim(),
        sku: String(variant.sku || `${sku}-${variant.size}`),
        available: variant.available !== false,
        stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : null,
      };
    });
    return {
      sku,
      styleRef: String(product.styleRef || ''),
      name: product.name.trim(),
      gender: String(product.gender || 'Unisex'),
      category: product.category.trim(),
      color: String(product.color || 'Assorted'),
      price: Math.max(0, Number(product.price)),
      mrp: Math.max(0, Number(product.mrp)),
      discount: Number.isFinite(Number(product.discount)) ? Number(product.discount) : 0,
      rating: Number.isFinite(Number(product.rating)) ? Number(product.rating) : null,
      reviews: Number.isFinite(Number(product.reviews)) ? Number(product.reviews) : 0,
      tag: String(product.tag || 'WYLD SPROG'),
      image: String(product.image || 'assets/products/p03.jpg'),
      description: String(product.description || ''),
      sizes,
    };
  });
}

function serveFile(req, res, urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(ROOT, relative);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return sendText(res, 403, 'Forbidden');
  if (/^data[\\/]|^tools[\\/]|(^|[\\/])\./.test(path.relative(ROOT, resolved))) return sendText(res, 403, 'Forbidden');
  if (['server.js', 'package.json', 'package-lock.json', 'README.md'].includes(path.basename(resolved))) return sendText(res, 403, 'Forbidden');
  let file = resolved;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendText(res, 404, 'Not found');
  const extension = path.extname(file).toLowerCase();
  baseHeaders(res);
  res.writeHead(200, {
    'Content-Type': MIME[extension] || 'application/octet-stream',
    'Content-Length': fs.statSync(file).size,
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (req.method === 'GET' && (route === '/api/bootstrap' || route === '/api/products')) {
    return sendJson(res, 200, { products: catalog, settings: publicSettings() });
  }
  if (req.method === 'GET' && route === '/api/settings') {
    return sendJson(res, 200, publicSettings());
  }
  if (req.method === 'GET' && route === '/healthz') {
    return sendJson(res, 200, { ok: true, products: catalog.length, orders: orders.length });
  }
  if (req.method === 'POST' && route === '/api/orders') {
    const body = await readBody(req);
    const order = await placeOrder(body);
    return sendJson(res, 201, { order: { ...order, customer: { ...order.customer } } });
  }
  if (req.method === 'POST' && route === '/api/admin/login') {
    const body = await readBody(req);
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = loginAttempts.get(ip) || { count: 0, reset: Date.now() + 10 * 60 * 1000 };
    if (attempt.reset < Date.now()) { attempt.count = 0; attempt.reset = Date.now() + 10 * 60 * 1000; }
    if (attempt.count >= 8) return sendJson(res, 429, { error: 'Too many sign-in attempts. Try again later.' });
    if (String(body.password || '') !== ADMIN_PASSWORD) {
      attempt.count += 1;
      loginAttempts.set(ip, attempt);
      return sendJson(res, 401, { error: 'Incorrect password' });
    }
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { expires: Date.now() + SESSION_TTL });
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const secure = proto === 'https' || /e2b\.app$/i.test(String(req.headers.host || ''));
    const cookie = `wyld_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}`;
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }
  if (req.method === 'POST' && route === '/api/admin/logout') {
    const token = parseCookies(req).wyld_admin;
    sessions.delete(token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'wyld_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (route.startsWith('/api/admin/')) {
    if (!requireAdmin(req, res)) return;

    if (req.method === 'GET' && route === '/api/admin/overview') {
      const availableVariants = catalog.reduce((total, product) =>
        total + product.sizes.filter(variant => variant.available !== false).length, 0);
      const revenue = orders.filter(order => order.status !== 'cancelled').reduce((total, order) => total + order.total, 0);
      return sendJson(res, 200, {
        products: catalog.length,
        availableVariants,
        orders: orders.length,
        revenue,
        catalog,
        settings: publicSettings(),
        ordersList: orders,
      });
    }
    if (req.method === 'GET' && route === '/api/admin/orders') {
      return sendJson(res, 200, { orders });
    }
    if (req.method === 'PATCH' && route === '/api/admin/inventory') {
      const body = await readBody(req);
      const sku = String(body.sku || '');
      const size = String(body.size || '');
      const product = findProduct(sku);
      const variant = findVariant(product, size);
      if (!variant) return sendJson(res, 404, { error: 'Size not found' });
      return withWrite(() => {
        const next = structuredClone(catalog);
        const target = findVariant(next.find(entry => entry.sku === sku), size);
        if (body.available !== undefined) target.available = Boolean(body.available);
        if (body.stock !== undefined) {
          if (body.stock === null || body.stock === '') target.stock = null;
          else {
            const stock = Number(body.stock);
            if (!Number.isFinite(stock) || stock < 0) throw Object.assign(new Error('Stock must be zero or more'), { status: 400 });
            target.stock = Math.floor(stock);
            target.available = target.stock > 0;
          }
        }
        writeJsonAtomic(CATALOG_FILE, next);
        writeCatalogJs(next);
        catalog = next;
        return sendJson(res, 200, { ok: true, variant: target });
      });
    }
    if (req.method === 'PATCH' && route.startsWith('/api/admin/orders/')) {
      const id = route.slice('/api/admin/orders/'.length);
      const body = await readBody(req);
      const status = String(body.status || '');
      if (!ORDER_STATUSES.has(status)) return sendJson(res, 400, { error: 'Invalid status' });
      return withWrite(() => {
        const nextOrders = structuredClone(orders);
        const order = nextOrders.find(entry => entry.id === id || entry.number === id);
        if (!order) return sendJson(res, 404, { error: 'Order not found' });
        const previous = order.status;
        order.status = status;
        order.updatedAt = new Date().toISOString();
        let nextCatalog = catalog;
        if (status === 'cancelled' && previous !== 'cancelled') {
          nextCatalog = structuredClone(catalog);
          for (const item of order.items) {
            const variant = findVariant(nextCatalog.find(entry => entry.sku === item.sku), item.size);
            if (variant && Number.isFinite(variant.stock)) {
              variant.stock += item.qty;
              variant.available = true;
            }
          }
          writeJsonAtomic(CATALOG_FILE, nextCatalog);
          writeCatalogJs(nextCatalog);
          catalog = nextCatalog;
        }
        writeJsonAtomic(ORDERS_FILE, nextOrders);
        orders = nextOrders;
        return sendJson(res, 200, { ok: true, order });
      });
    }
    if (req.method === 'PUT' && route === '/api/admin/catalog') {
      const body = await readBody(req);
      const next = validateImportedProducts(body.products);
      return withWrite(() => {
        writeJsonAtomic(CATALOG_FILE, next);
        writeCatalogJs(next);
        catalog = next;
        return sendJson(res, 200, { ok: true, count: next.length });
      });
    }
    if (req.method === 'PATCH' && route === '/api/admin/settings') {
      const body = await readBody(req);
      const allowed = ['storeName', 'shippingFee', 'freeShippingThreshold', 'shippingPolicy', 'returnPolicy', 'supportEmail', 'codEnabled', 'upiEnabled'];
      const next = { ...settings };
      for (const key of allowed) {
        if (body[key] !== undefined) next[key] = body[key];
      }
      next.shippingFee = Math.max(0, Number(next.shippingFee) || 0);
      next.freeShippingThreshold = Math.max(0, Number(next.freeShippingThreshold) || 0);
      next.codEnabled = Boolean(next.codEnabled);
      next.upiEnabled = Boolean(next.upiEnabled);
      return withWrite(() => {
        writeJsonAtomic(SETTINGS_FILE, next);
        settings = next;
        return sendJson(res, 200, { ok: true, settings: publicSettings() });
      });
    }
    return sendJson(res, 404, { error: 'Not found' });
  }
  return sendJson(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    if (url.pathname === '/admin' || url.pathname === '/admin/') {
      req.url = '/admin.html';
    }
    return serveFile(req, res, url.pathname === '/admin' || url.pathname === '/admin/' ? '/admin.html' : url.pathname);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? 'Server error' : error.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Wyld Sprog store running at http://${HOST}:${PORT}`);
  console.log(`Admin: /admin (password: ${ADMIN_PASSWORD === 'wyld-sprog-preview' ? 'wyld-sprog-preview (preview default)' : 'set via WYLD_ADMIN_PASSWORD'})`);
});
