(() => {
  'use strict';

  const state = {
    authenticated: false,
    catalog: [],
    orders: [],
    settings: {},
    stats: {},
    activeTab: 'inventory',
    query: '',
    catalogFile: null,
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = amount => `₹${Number(amount || 0).toLocaleString('en-IN')}`;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

  async function request(url, options = {}) {
    const headers = { 'X-Wyld-Admin': '1', ...(options.headers || {}) };
    let body = options.body;
    if (body && typeof body !== 'string' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(url, { ...options, body, headers, credentials: 'same-origin', cache: 'no-store' });
    let data = {};
    try { data = await response.json(); } catch { /* empty response */ }
    return { ok: response.ok, status: response.status, data };
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function showLogin() {
    state.authenticated = false;
    $('#login-view').hidden = false;
    $('#admin-view').hidden = true;
    $('#logout').hidden = true;
  }

  function showDashboard(data) {
    state.authenticated = true;
    state.catalog = data.catalog || [];
    state.orders = data.ordersList || [];
    state.settings = data.settings || {};
    state.stats = data;
    $('#login-view').hidden = true;
    $('#admin-view').hidden = false;
    $('#logout').hidden = false;
    $('#mode-label').textContent = '· LIVE SERVER';
    $('#stat-products').textContent = data.products || 0;
    $('#stat-variants').textContent = data.availableVariants || 0;
    $('#stat-orders').textContent = data.orders || 0;
    $('#stat-revenue').textContent = money(data.revenue);
    fillSettings();
    renderInventory();
    renderOrders();
  }

  async function loadOverview() {
    const result = await request('/api/admin/overview');
    if (result.ok) {
      showDashboard(result.data);
      return true;
    }
    showLogin();
    return false;
  }

  function formatDate(value) {
    try {
      return new Date(value).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return value || '';
    }
  }

  function renderInventory() {
    const query = state.query.toLowerCase();
    const products = state.catalog.filter(product =>
      `${product.sku} ${product.name} ${product.category} ${product.color} ${product.gender}`.toLowerCase().includes(query)
    );
    if (!products.length) {
      $('#inventory-body').innerHTML = '<tr><td colspan="5">No styles match that search.</td></tr>';
      return;
    }
    $('#inventory-body').innerHTML = products.map(product => {
      const rows = (product.sizes || []).map(variant => `
        <div class="variant-row" data-size="${escapeHtml(variant.size)}">
          <span>${escapeHtml(variant.size)}</span>
          <input type="number" min="0" step="1" value="${variant.stock == null ? '' : Number(variant.stock)}" placeholder="Auto" aria-label="Stock for ${escapeHtml(variant.size)}">
          <label><input type="checkbox" ${variant.available !== false ? 'checked' : ''}> Available</label>
        </div>`).join('');
      return `<tr>
        <td><div class="product-cell"><img src="${escapeHtml(product.image)}" alt=""><div><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.sku)} · ${escapeHtml(product.color || 'Assorted')}</small></div></div></td>
        <td>${escapeHtml(product.category)}</td>
        <td>${money(product.price)}<br><small>${escapeHtml(product.discount)}% off</small></td>
        <td><div class="variant-list">${rows || '<small>No sizes</small>'}</div></td>
        <td><button class="save-row" data-sku="${escapeHtml(product.sku)}">Save stock</button></td>
      </tr>`;
    }).join('');
  }

  function renderOrders() {
    if (!state.orders.length) {
      $('#orders-body').innerHTML = '<tr><td colspan="6">No orders yet. Place a cash-on-delivery order in the storefront to see it here.</td></tr>';
      return;
    }
    $('#orders-body').innerHTML = state.orders.map(order => {
      const items = (order.items || []).map(item => `${escapeHtml(item.name)} · ${escapeHtml(item.size)} × ${item.qty}`).join('<br>');
      return `<tr>
        <td><b>${escapeHtml(order.number)}</b><br><small>${escapeHtml(formatDate(order.createdAt))}</small></td>
        <td class="customer-cell"><b>${escapeHtml(order.customer.name)}</b><small>${escapeHtml(order.customer.phone)}<br>${escapeHtml(order.customer.email)}</small></td>
        <td class="order-items">${items}</td>
        <td><b>${money(order.total)}</b><br><small>${escapeHtml(order.paymentMethod.toUpperCase())}</small></td>
        <td><select class="status-select" aria-label="Order status">${['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map(status => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></td>
        <td><button class="save-status" data-order-id="${escapeHtml(order.id)}">Update</button></td>
      </tr>`;
    }).join('');
  }

  function fillSettings() {
    const form = $('#settings-form');
    const values = state.settings;
    form.elements.storeName.value = values.storeName || '';
    form.elements.supportEmail.value = values.supportEmail || '';
    form.elements.shippingFee.value = values.shippingFee ?? 0;
    form.elements.freeShippingThreshold.value = values.freeShippingThreshold ?? 0;
    form.elements.shippingPolicy.value = values.shippingPolicy || '';
    form.elements.returnPolicy.value = values.returnPolicy || '';
    form.elements.codEnabled.checked = Boolean(values.codEnabled);
  }

  async function saveInventory(sku, button) {
    const row = button.closest('tr');
    const variants = [...row.querySelectorAll('.variant-row')].map(variantRow => ({
      size: variantRow.dataset.size,
      stockValue: variantRow.querySelector('input[type="number"]').value,
      available: variantRow.querySelector('input[type="checkbox"]').checked,
    }));
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      for (const variant of variants) {
        const result = await request('/api/admin/inventory', {
          method: 'PATCH',
          body: {
            sku,
            size: variant.size,
            stock: variant.stockValue === '' ? null : Number(variant.stockValue),
            available: variant.available,
          },
        });
        if (!result.ok) throw new Error(result.data.error || 'Could not save stock');
      }
      await loadOverview();
      showToast(`Stock saved for ${sku}`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Save stock';
      showToast(error.message || 'Could not save stock');
    }
  }

  async function saveOrderStatus(id, button) {
    const status = button.closest('tr').querySelector('.status-select').value;
    button.disabled = true;
    button.textContent = 'Saving…';
    const result = await request(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
    if (!result.ok) {
      button.disabled = false;
      button.textContent = 'Update';
      showToast(result.data.error || 'Could not update order');
      return;
    }
    await loadOverview();
    showToast(`Order marked ${status}`);
  }

  function downloadCatalog() {
    const payload = JSON.stringify({ products: state.catalog }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wyld-sprog-catalog.json';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Catalog JSON downloaded');
  }

  async function importCatalog() {
    if (!state.catalogFile) {
      showToast('Choose a catalog JSON file first');
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(await state.catalogFile.text());
    } catch {
      showToast('That file is not valid JSON');
      return;
    }
    const products = Array.isArray(parsed) ? parsed : parsed.products;
    if (!Array.isArray(products) || !products.length) {
      showToast('The file must contain a products array');
      return;
    }
    if (!window.confirm(`Replace the current ${state.catalog.length} styles with ${products.length} styles from this file?`)) return;
    const button = $('#import-catalog');
    button.disabled = true;
    button.textContent = 'Importing…';
    const result = await request('/api/admin/catalog', { method: 'PUT', body: { products } });
    button.disabled = false;
    button.textContent = 'Replace catalog ↑';
    if (!result.ok) return showToast(result.data.error || 'Could not import catalog');
    await loadOverview();
    showToast(`Catalog updated with ${result.data.count} styles`);
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const body = {
      storeName: form.elements.storeName.value.trim(),
      supportEmail: form.elements.supportEmail.value.trim(),
      shippingFee: Number(form.elements.shippingFee.value),
      freeShippingThreshold: Number(form.elements.freeShippingThreshold.value),
      shippingPolicy: form.elements.shippingPolicy.value.trim(),
      returnPolicy: form.elements.returnPolicy.value.trim(),
      codEnabled: form.elements.codEnabled.checked,
    };
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const result = await request('/api/admin/settings', { method: 'PATCH', body });
    button.disabled = false;
    if (!result.ok) return showToast(result.data.error || 'Could not save settings');
    state.settings = result.data.settings;
    showToast('Store settings saved');
  }

  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    button.textContent = 'Signing in…';
    const result = await request('/api/admin/login', {
      method: 'POST',
      body: { password: $('#admin-password').value },
    });
    button.disabled = false;
    button.innerHTML = 'Open dashboard <span>↗</span>';
    if (!result.ok) {
      $('#admin-password').value = '';
      showToast(result.data.error || 'Sign-in failed');
      return;
    }
    $('#admin-password').value = '';
    await loadOverview();
  });

  $('#logout').addEventListener('click', async () => {
    await request('/api/admin/logout', { method: 'POST', body: {} });
    showLogin();
    showToast('Signed out');
  });

  $('#refresh').addEventListener('click', async () => {
    await loadOverview();
    showToast('Store data refreshed');
  });

  $('.admin-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    state.activeTab = button.dataset.tab;
    $$('.admin-tabs button').forEach(item => item.classList.toggle('active', item === button));
    $$('.admin-tab').forEach(section => { section.hidden = section.id !== `tab-${state.activeTab}`; });
  });

  $('#inventory-search').addEventListener('input', event => {
    state.query = event.target.value.trim();
    renderInventory();
  });

  $('#inventory-body').addEventListener('click', event => {
    const button = event.target.closest('[data-sku]');
    if (button) saveInventory(button.dataset.sku, button);
  });

  $('#orders-body').addEventListener('click', event => {
    const button = event.target.closest('[data-order-id]');
    if (button) saveOrderStatus(button.dataset.orderId, button);
  });

  $('#download-catalog').addEventListener('click', downloadCatalog);
  $('#catalog-file').addEventListener('change', event => {
    state.catalogFile = event.target.files?.[0] || null;
    $('#file-note').textContent = state.catalogFile
      ? `Selected: ${state.catalogFile.name}. Review it before replacing the live catalog.`
      : 'No file selected. The JSON must contain a products array with SKU, name, category, price, MRP and sizes.';
  });
  $('#import-catalog').addEventListener('click', importCatalog);
  $('#settings-form').addEventListener('submit', saveSettings);

  loadOverview();
})();
