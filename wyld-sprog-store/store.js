(() => {
  'use strict';

  const fallbackProducts = window.WYLD_PRODUCTS || [];
  const defaultSettings = {
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
  const categoryKeys = ['T-shirts', 'Clothing sets', 'Night suits', 'Sweatshirts', 'Track pants'];
  const genderKeys = ['Boys', 'Girls', 'Unisex', 'Women', 'Men'];
  const colorSwatches = {
    Assorted: '#d8d8cf', Black: '#2f312b', Blue: '#6a8cc7', 'Navy Blue': '#344b73',
    'Turquoise Blue': '#4aaeb2', 'Sea Green': '#70b9a4', Green: '#8bbf73', Yellow: '#e7c85a',
    Orange: '#e99b57', Pink: '#e7a4b9', Purple: '#a58ac5', Grey: '#a7aaa0', White: '#f5f3e9',
    Peach: '#eab99d', Rose: '#d98b94', Teal: '#4d8f8a', Multicoloured: '#d36c8d',
    'Fluorescent Green': '#c9e65a', Beige: '#d8c9a7', Red: '#d96863', Melange: '#b9b7ad',
    Maroon: '#8f4a55', Coral: '#e78c7b', 'Lime Green': '#c3dd63', Rust: '#b86f4c',
  };

  let products = fallbackProducts;
  let settings = { ...defaultSettings };
  let apiMode = false;
  let bySku = new Map();
  let toastTimer;

  const state = {
    category: 'All', genders: new Set(), colors: new Set(), price: 'all', discount: 'all',
    size: '', inStockOnly: false, sort: 'featured', query: '', onlySaved: false, visible: 24,
    saved: new Set(readStorage('wyld-store-v3-saved', [])),
    bag: sanitizeBag(readStorage('wyld-store-v3-bag', [])),
    selectedProduct: null, selectedSize: '',
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = amount => `₹${Number(amount || 0).toLocaleString('en-IN')}`;
  const dialog = $('#quick-view');
  const checkoutDialog = $('#checkout-dialog');
  const grid = $('#product-grid');

  function readStorage(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function persist() {
    localStorage.setItem('wyld-store-v3-saved', JSON.stringify([...state.saved]));
    localStorage.setItem('wyld-store-v3-bag', JSON.stringify(state.bag));
  }

  function sanitizeBag(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(item => item && typeof item.sku === 'string' && typeof item.size === 'string')
      .map(item => ({ sku: item.sku, size: item.size, qty: Math.max(1, Math.min(20, Number(item.qty) || 1)) }));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function variants(product) {
    return Array.isArray(product?.sizes) ? product.sizes : [];
  }

  function variantFor(product, size) {
    return variants(product).find(variant => variant.size === size);
  }

  function isAvailable(product) {
    return variants(product).some(variant => variant.available !== false);
  }

  function variantLabel(variant) {
    if (variant.available === false) return 'Sold out';
    if (Number.isFinite(variant.stock)) return variant.stock > 0 ? `${variant.stock} left` : 'Sold out';
    return 'Available';
  }

  function productStockLabel(product) {
    const list = variants(product).filter(variant => variant.available !== false);
    if (!list.length) return 'Sold out';
    const low = list.find(variant => Number.isFinite(variant.stock) && variant.stock > 0 && variant.stock <= 3);
    return low ? `Only ${low.stock} left` : 'Available';
  }

  function buildMaps() {
    bySku = new Map(products.map(product => [product.sku, product]));
  }

  function countFor(category) {
    return products.filter(product => product.category === category).length;
  }

  function colorCounts() {
    return products.reduce((result, product) => {
      const color = product.color || 'Assorted';
      result[color] = (result[color] || 0) + 1;
      return result;
    }, {});
  }

  function allSizes() {
    return [...new Set(products.flatMap(product => variants(product).map(variant => variant.size)))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }

  function renderChrome() {
    $('#hero-count').textContent = `${products.length} STYLES · ONE HAPPY WARDROBE`;
    $('#catalog-total').innerHTML = `${products.length}<span> styles</span>`;
    $('#catalog-foot-count').textContent = `${products.length} WYLD SPROG STYLES · ONE BRAND-OWNED SHOP`;
    $('#category-counts').innerHTML = categoryKeys.map(category =>
      `<span>${escapeHtml(category.toUpperCase())}<b>${countFor(category)}</b></span>`
    ).join('') + '<small>Every style in this store is managed directly by Wyld Sprog.</small>';
    const adminLink = $('a[href="/admin"]');
    if (adminLink) adminLink.hidden = !apiMode;
    $('#policy-shipping').textContent = `${settings.shippingPolicy} ${money(settings.shippingFee)} shipping, free on orders over ${money(settings.freeShippingThreshold)}.`;
    $('#policy-returns').textContent = settings.returnPolicy;
    $('#checkout-warning').textContent = settings.codEnabled
      ? 'Cash-on-delivery orders are saved securely on this store. Online payment is not connected yet.'
      : 'Checkout is not enabled yet. Please contact the store.';
  }

  function buildCategories() {
    const categories = [['All', 'All styles', products.length], ...categoryKeys.map(category => [category, category, countFor(category)])];
    $('#category-rail').innerHTML = categories.map(([key, label, count]) =>
      `<button class="category-pill ${state.category === key ? 'active' : ''}" data-category="${key}">${escapeHtml(label)}<small>${count}</small></button>`
    ).join('');
  }

  function buildSizes() {
    $('#size-filters').innerHTML = allSizes().map(size =>
      `<button class="size-chip ${state.size === size ? 'active' : ''}" data-size="${escapeHtml(size)}" aria-pressed="${state.size === size}">${escapeHtml(size)}</button>`
    ).join('');
  }

  function buildColors() {
    const counts = colorCounts();
    const colors = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    $('#color-filters').innerHTML = colors.map(color => {
      const swatch = colorSwatches[color] || '#cfd2c3';
      return `<label><input type="checkbox" name="color" value="${escapeHtml(color)}" ${state.colors.has(color) ? 'checked' : ''}><span class="swatch" style="--swatch:${swatch}"></span><span>${escapeHtml(color)}</span><small>${counts[color]}</small></label>`;
    }).join('');
  }

  function buildGenders() {
    $('#gender-filters').innerHTML = genderKeys.map(gender =>
      `<label><input type="checkbox" name="gender" value="${gender}" ${state.genders.has(gender) ? 'checked' : ''}> ${gender === 'Unisex' ? 'Unisex & kids' : gender}</label>`
    ).join('');
  }

  function resetVisible() {
    state.visible = 24;
  }

  function filteredProducts() {
    let list = products.filter(product => {
      const sizeList = variants(product);
      const searchText = [
        product.name, product.sku, product.color, product.gender, product.category,
        product.tag, product.description, sizeList.map(variant => variant.size).join(' '),
      ].join(' ').toLowerCase();
      if (state.category !== 'All' && product.category !== state.category) return false;
      if (state.genders.size && !state.genders.has(product.gender)) return false;
      if (state.colors.size && !state.colors.has(product.color || 'Assorted')) return false;
      if (state.size && !sizeList.some(variant => variant.size === state.size && variant.available !== false)) return false;
      if (state.inStockOnly && !isAvailable(product)) return false;
      if (state.onlySaved && !state.saved.has(product.sku)) return false;
      if (state.query && !searchText.includes(state.query.toLowerCase())) return false;
      if (state.price === 'under400' && product.price >= 400) return false;
      if (state.price === '400to700' && (product.price < 400 || product.price > 700)) return false;
      if (state.price === 'over700' && product.price <= 700) return false;
      if (state.discount !== 'all' && product.discount < Number(state.discount)) return false;
      return true;
    });
    if (state.sort === 'price-asc') list.sort((a, b) => a.price - b.price);
    if (state.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
    if (state.sort === 'discount') list.sort((a, b) => b.discount - a.discount);
    if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  function productCard(product) {
    const available = isAvailable(product);
    const wishActive = state.saved.has(product.sku);
    return `<article class="product-card ${available ? '' : 'is-sold-out'}" data-product="${escapeHtml(product.sku)}" tabindex="0" aria-label="View ${escapeHtml(product.name)}">
      <div class="product-image"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy">
        <span class="product-badge">${escapeHtml(product.tag)}</span>
        <button class="wish-button ${wishActive ? 'active' : ''}" data-wish="${escapeHtml(product.sku)}" aria-label="${wishActive ? 'Remove from' : 'Add to'} favourites">${wishActive ? '♥' : '♡'}</button>
        <button class="quick-add-card" data-quick="${escapeHtml(product.sku)}" ${available ? '' : 'disabled'}>QUICK ADD　＋</button>
      </div><div class="product-info"><div class="product-brand">WYLD SPROG <span>${escapeHtml(product.sku)}</span></div>
        <div class="product-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</div>
        <div class="product-meta">${escapeHtml(product.color || 'Assorted')} · ${escapeHtml(product.gender)}</div>
        <div class="price-line"><span class="price">${money(product.price)}</span><span class="mrp">${money(product.mrp)}</span><span class="discount">(${product.discount}% OFF)</span></div>
        <div class="product-stock ${available ? '' : 'out'}">${escapeHtml(productStockLabel(product))}</div>
      </div></article>`;
  }

  function activeFilterTags() {
    const tags = [];
    state.genders.forEach(gender => tags.push(`<span class="filter-tag">${escapeHtml(gender)}<button data-remove-gender="${escapeHtml(gender)}" aria-label="Remove ${gender} filter">×</button></span>`));
    state.colors.forEach(color => tags.push(`<span class="filter-tag"><i class="tag-swatch" style="--swatch:${colorSwatches[color] || '#cfd2c3'}"></i>${escapeHtml(color)}<button data-remove-color="${escapeHtml(color)}" aria-label="Remove ${color} filter">×</button></span>`));
    if (state.size) tags.push(`<span class="filter-tag">Size ${escapeHtml(state.size)}<button data-clear-size aria-label="Clear size filter">×</button></span>`);
    if (state.price !== 'all') tags.push(`<span class="filter-tag">${{ under400: 'Under ₹400', '400to700': '₹400 – ₹700', over700: 'Over ₹700' }[state.price]}<button data-clear-price aria-label="Clear price filter">×</button></span>`);
    if (state.discount !== 'all') tags.push(`<span class="filter-tag">${state.discount}%+ off<button data-clear-discount aria-label="Clear discount filter">×</button></span>`);
    if (state.inStockOnly) tags.push('<span class="filter-tag">Available only<button data-clear-stock aria-label="Clear stock filter">×</button></span>');
    if (state.query) tags.push(`<span class="filter-tag">“${escapeHtml(state.query)}”<button data-clear-query aria-label="Clear search">×</button></span>`);
    if (state.onlySaved) tags.push('<span class="filter-tag">Saved styles<button data-clear-saved aria-label="Show all styles">×</button></span>');
    return tags.join('');
  }

  function render() {
    buildCategories();
    buildSizes();
    buildColors();
    buildGenders();
    renderChrome();
    $('#in-stock-only').checked = state.inStockOnly;
    $$('input[name="price"]').forEach(input => { input.checked = input.value === state.price; });
    $$('input[name="discount"]').forEach(input => { input.checked = input.value === state.discount; });
    $('#sort-select').value = state.sort;
    const list = filteredProducts();
    const visible = list.slice(0, state.visible);
    grid.innerHTML = visible.map(productCard).join('');
    grid.hidden = !list.length;
    $('#empty-state').hidden = !!list.length;
    $('#load-more-wrap').hidden = visible.length >= list.length;
    $('#results-count').textContent = state.onlySaved ? `${list.length} saved styles` : `${list.length} styles`;
    $('#active-filters').innerHTML = activeFilterTags();
    $('#wish-count').textContent = state.saved.size;
  }

  function showToast(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600);
  }

  function toggleWish(sku) {
    state.saved.has(sku) ? state.saved.delete(sku) : state.saved.add(sku);
    persist();
    render();
  }

  function openQuick(sku) {
    const product = bySku.get(sku);
    if (!product) return;
    state.selectedProduct = product;
    state.selectedSize = '';
    $('#quick-image').src = product.image;
    $('#quick-image').alt = product.name;
    $('#quick-sku').textContent = product.sku;
    $('#quick-title').textContent = product.name;
    $('#quick-desc').textContent = product.description;
    $('#quick-meta').innerHTML = `<span>${escapeHtml(product.gender)}</span><span>${escapeHtml(product.color || 'Assorted')}</span><span>${escapeHtml(product.category)}</span>`;
    $('#quick-price').innerHTML = `${money(product.price)} <del>${money(product.mrp)}</del> <span>${product.discount}% OFF</span>`;
    $('#quick-sizes').innerHTML = variants(product).map(variant =>
      `<button class="quick-size" data-quick-size="${escapeHtml(variant.size)}" ${variant.available === false ? 'disabled' : ''}><span>${escapeHtml(variant.size)}</span><small>${escapeHtml(variantLabel(variant))}</small></button>`
    ).join('');
    $('#size-note').textContent = isAvailable(product)
      ? 'Select a size to add this style to your bag.'
      : 'This style is currently sold out.';
    $('#quick-add').disabled = true;
    dialog.showModal();
  }

  function addToBag(sku, size) {
    const product = bySku.get(sku);
    const variant = product && variantFor(product, size);
    if (!product || !variant || variant.available === false) {
      showToast('That size is not available');
      return;
    }
    const existing = state.bag.find(item => item.sku === sku && item.size === size);
    if (existing) {
      if (Number.isFinite(variant.stock) && existing.qty >= variant.stock) {
        showToast(`Only ${variant.stock} available in this size`);
        return;
      }
      existing.qty = Math.min(20, existing.qty + 1);
    } else {
      state.bag.push({ sku, size, qty: 1 });
    }
    persist();
    renderBag();
    dialog.close();
    showToast('Added to your little bag');
  }

  function changeQty(index, delta) {
    const item = state.bag[index];
    if (!item) return;
    const variant = variantFor(bySku.get(item.sku), item.size);
    const max = Number.isFinite(variant?.stock) ? variant.stock : 20;
    const next = Math.max(0, Math.min(max, item.qty + delta));
    if (next === 0) state.bag.splice(index, 1);
    else item.qty = next;
    persist();
    renderBag();
  }

  function cartSubtotal() {
    return state.bag.reduce((total, item) => total + (bySku.get(item.sku)?.price || 0) * item.qty, 0);
  }

  function shippingFor(subtotal) {
    if (!subtotal || subtotal >= settings.freeShippingThreshold) return 0;
    return Number(settings.shippingFee) || 0;
  }

  function renderBag() {
    const count = state.bag.reduce((total, item) => total + item.qty, 0);
    $('#bag-count').textContent = count;
    $('#bag-title-count').textContent = `(${count})`;
    $('#bag-items').innerHTML = state.bag.map((item, index) => {
      const product = bySku.get(item.sku);
      if (!product) return '';
      return `<div class="bag-row"><img src="${escapeHtml(product.image)}" alt=""><div><h3>${escapeHtml(product.name)}</h3><p>Size ${escapeHtml(item.size)} · ${escapeHtml(item.sku)}</p><div class="qty-control"><button data-qty="-1" data-bag-index="${index}" aria-label="Decrease quantity">−</button><b>${item.qty}</b><button data-qty="1" data-bag-index="${index}" aria-label="Increase quantity">+</button></div><strong>${money(product.price * item.qty)}</strong><button class="remove-item" data-remove-bag="${index}">Remove</button></div></div>`;
    }).join('');
    const empty = !state.bag.length;
    $('#bag-empty').classList.toggle('hidden', !empty);
    $('#bag-bottom').classList.toggle('hidden', empty);
    $('#bag-items').style.display = empty ? 'none' : 'block';
    const subtotal = cartSubtotal();
    $('#bag-subtotal').textContent = money(subtotal);
    $('#bag-shipping-note').textContent = subtotal >= settings.freeShippingThreshold
      ? 'You unlocked free shipping.'
      : `Add ${money(settings.freeShippingThreshold - subtotal)} more for free shipping.`;
  }

  function openBag() {
    $('#overlay').classList.add('open');
    $('#bag-drawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeBag() {
    $('#overlay').classList.remove('open');
    $('#bag-drawer').classList.remove('open');
    document.body.style.overflow = '';
  }

  function clearFilters() {
    state.category = 'All'; state.genders.clear(); state.colors.clear(); state.price = 'all';
    state.discount = 'all'; state.size = ''; state.inStockOnly = false; state.query = '';
    state.onlySaved = false; state.sort = 'featured'; resetVisible();
    $('#search-input').value = '';
    render();
  }

  function updateCheckoutTotals() {
    const subtotal = cartSubtotal();
    const shipping = shippingFor(subtotal);
    $('#checkout-subtotal').textContent = money(subtotal);
    $('#checkout-shipping').textContent = shipping ? money(shipping) : 'FREE';
    $('#checkout-total').textContent = money(subtotal + shipping);
  }

  function openCheckout() {
    if (!state.bag.length) return;
    if (!apiMode || !settings.codEnabled) {
      showToast('Checkout is available when the store server is running');
      return;
    }
    closeBag();
    $('#checkout-form').reset();
    $('#checkout-form').hidden = false;
    $('#checkout-success').hidden = true;
    $('#checkout-submit').disabled = false;
    $('#checkout-submit').textContent = 'Place cash-on-delivery order';
    updateCheckoutTotals();
    checkoutDialog.showModal();
  }

  function showCheckoutSuccess(title, copy) {
    $('#checkout-form').hidden = true;
    $('#checkout-success').hidden = false;
    $('#checkout-success-title').textContent = title;
    $('#checkout-success-copy').textContent = copy;
  }

  async function submitCheckout(event) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const customer = {
      name: String(data.name || '').trim(),
      phone: String(data.phone || '').trim(),
      email: String(data.email || '').trim(),
      address: String(data.address || '').trim(),
      city: String(data.city || '').trim(),
      pin: String(data.pin || '').trim(),
    };
    const items = state.bag.map(({ sku, size, qty }) => ({ sku, size, qty }));
    if (!apiMode) {
      showCheckoutSuccess('Demo order only', 'Run the Wyld Sprog store server to save real orders. Nothing was submitted.');
      return;
    }
    const button = $('#checkout-submit');
    button.disabled = true;
    button.textContent = 'Placing your order…';
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer, items, paymentMethod: 'cod' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not place the order');
      state.bag = [];
      persist();
      renderBag();
      showCheckoutSuccess('Order received!', `Order ${result.order.number} is saved. Questions? Email ${settings.supportEmail}.`);
      showToast(`Order ${result.order.number} placed`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Place cash-on-delivery order';
      showToast(error.message || 'Could not place the order');
    }
  }

  function applyBootstrap(data) {
    if (Array.isArray(data.products) && data.products.length) {
      products = data.products;
      settings = { ...defaultSettings, ...(data.settings || {}) };
      apiMode = true;
      buildMaps();
      state.bag = sanitizeBag(state.bag).filter(item => {
        const variant = variantFor(bySku.get(item.sku), item.size);
        return variant && variant.available !== false;
      });
      persist();
      renderBag();
      render();
    }
  }

  async function bootstrap() {
    try {
      const response = await fetch('/api/bootstrap', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      applyBootstrap(await response.json());
    } catch {
      // Static preview: use the generated catalog.js fallback.
    }
  }

  function bindEvents() {
    $('#category-rail').addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      state.category = button.dataset.category;
      state.onlySaved = false;
      resetVisible();
      render();
    });

    document.addEventListener('click', event => {
      const nav = event.target.closest('[data-jump]');
      if (nav) {
        event.preventDefault();
        state.category = nav.dataset.jump;
        state.onlySaved = false;
        resetVisible();
        render();
        $('.main-nav').classList.remove('mobile-open');
        $('#shop').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const wish = event.target.closest('[data-wish]');
      if (wish) { event.stopPropagation(); toggleWish(wish.dataset.wish); return; }
      const quick = event.target.closest('[data-quick]');
      if (quick) { event.stopPropagation(); openQuick(quick.dataset.quick); return; }
      const product = event.target.closest('[data-product]');
      if (product && !event.target.closest('button')) { openQuick(product.dataset.product); return; }
      const size = event.target.closest('[data-size]');
      if (size) { state.size = state.size === size.dataset.size ? '' : size.dataset.size; resetVisible(); render(); return; }
      const removeGender = event.target.closest('[data-remove-gender]');
      if (removeGender) { state.genders.delete(removeGender.dataset.removeGender); resetVisible(); render(); return; }
      const removeColor = event.target.closest('[data-remove-color]');
      if (removeColor) { state.colors.delete(removeColor.dataset.removeColor); resetVisible(); render(); return; }
      if (event.target.closest('[data-clear-size]')) { state.size = ''; resetVisible(); render(); return; }
      if (event.target.closest('[data-clear-price]')) { state.price = 'all'; resetVisible(); render(); return; }
      if (event.target.closest('[data-clear-discount]')) { state.discount = 'all'; resetVisible(); render(); return; }
      if (event.target.closest('[data-clear-stock]')) { state.inStockOnly = false; resetVisible(); render(); return; }
      if (event.target.closest('[data-clear-query]')) { state.query = ''; $('#search-input').value = ''; resetVisible(); render(); return; }
      if (event.target.closest('[data-clear-saved]')) { state.onlySaved = false; resetVisible(); render(); return; }
      const qty = event.target.closest('[data-qty]');
      if (qty) { changeQty(Number(qty.dataset.bagIndex), Number(qty.dataset.qty)); return; }
      const removeBag = event.target.closest('[data-remove-bag]');
      if (removeBag) { state.bag.splice(Number(removeBag.dataset.removeBag), 1); persist(); renderBag(); return; }
      const quickSize = event.target.closest('[data-quick-size]');
      if (quickSize) {
        if (quickSize.disabled) return;
        state.selectedSize = quickSize.dataset.quickSize;
        $$('.quick-size').forEach(button => button.classList.toggle('selected', button === quickSize));
        $('#quick-add').disabled = false;
        $('#size-note').textContent = `Size ${state.selectedSize} selected. Stock is managed by Wyld Sprog.`;
      }
    });

    document.addEventListener('change', event => {
      const target = event.target;
      if (target.matches('input[name="gender"]')) {
        target.checked ? state.genders.add(target.value) : state.genders.delete(target.value);
        resetVisible(); render();
      } else if (target.matches('input[name="price"]')) {
        state.price = target.value; resetVisible(); render();
      } else if (target.matches('input[name="discount"]')) {
        state.discount = target.value; resetVisible(); render();
      } else if (target.matches('input[name="color"]')) {
        target.checked ? state.colors.add(target.value) : state.colors.delete(target.value);
        resetVisible(); render();
      } else if (target.id === 'in-stock-only') {
        state.inStockOnly = target.checked; resetVisible(); render();
      }
    });

    grid.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-product]')) {
        event.preventDefault();
        openQuick(event.target.dataset.product);
      }
    });
    $('#sort-select').addEventListener('change', event => { state.sort = event.target.value; resetVisible(); render(); });
    $('#clear-filters').addEventListener('click', clearFilters);
    $('#empty-clear').addEventListener('click', clearFilters);
    $('#load-more').addEventListener('click', () => { state.visible += 24; render(); });
    $('#search-input').addEventListener('input', event => { state.query = event.target.value.trim(); state.onlySaved = false; resetVisible(); render(); });
    $('.search-toggle').addEventListener('click', () => {
      $('#search-panel').classList.toggle('open');
      if ($('#search-panel').classList.contains('open')) $('#search-input').focus();
    });
    $('#search-close').addEventListener('click', () => {
      $('#search-panel').classList.remove('open'); $('#search-input').value = ''; state.query = ''; render();
    });
    $('.heart-top').addEventListener('click', () => {
      state.onlySaved = !state.onlySaved; state.category = 'All'; resetVisible();
      $('#shop').scrollIntoView({ behavior: 'smooth' }); render();
      if (!state.saved.size && state.onlySaved) showToast('Tap a heart to save a little favourite');
    });
    $('#bag-open').addEventListener('click', openBag);
    $('#bag-close').addEventListener('click', closeBag);
    $('#overlay').addEventListener('click', () => {
      closeBag(); $('#filters').classList.remove('mobile-open'); document.body.style.overflow = '';
    });
    $('#bag-shop').addEventListener('click', () => { closeBag(); $('#shop').scrollIntoView({ behavior: 'smooth' }); });
    $('#bag-checkout').addEventListener('click', openCheckout);
    $('#quick-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    $('#quick-add').addEventListener('click', () => {
      if (state.selectedProduct && state.selectedSize) addToBag(state.selectedProduct.sku, state.selectedSize);
    });
    $('#mobile-filter').addEventListener('click', () => {
      $('#filters').classList.add('mobile-open'); $('#overlay').classList.add('open'); document.body.style.overflow = 'hidden';
    });
    $('.menu-toggle').addEventListener('click', () => $('.main-nav').classList.toggle('mobile-open'));
    $('#preview-dismiss').addEventListener('click', () => $('.preview-banner').remove());
    $('#checkout-close').addEventListener('click', () => checkoutDialog.close());
    checkoutDialog.addEventListener('click', event => { if (event.target === checkoutDialog) checkoutDialog.close(); });
    $('#checkout-form').addEventListener('submit', submitCheckout);
    $('#checkout-done').addEventListener('click', () => checkoutDialog.close());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { $('#filters').classList.remove('mobile-open'); document.body.style.overflow = ''; }
    });
  }

  buildMaps();
  bindEvents();
  render();
  renderBag();
  bootstrap();
})();
