'use strict';
/*
 * NazzGabbikes - browser UI
 * Talks to the Node API:
 *   GET  /api/status    -> COBOL health check (status pill)
 *   GET  /api/products  -> loads the catalog and stock
 *   POST /api/checkout  -> "Place order" (COBOL calculates the totals)
 *   POST /api/reset     -> "Reset stock"
 * The basket lives only in the browser; stock changes only after a
 * successful checkout response.
 */
(() => {
  const isFilePreview = location.protocol === 'file:';

  // Display-only extras (icon + description). Prices and stock come from the API.
  const META = {
    'trailblazer-mtb': { icon: '\u{1F6B5}', desc: 'Tough trail bike with 21 speeds.' },
    'velocity-road': { icon: '\u{1F6B4}', desc: 'Light, fast and built for the highway.' },
    'streetkid-bmx': { icon: '\u{1F6B2}', desc: 'Strong frame for tricks and street rides.' },
    'aero-helmet': { icon: '⛑️', desc: 'Lightweight, ventilated safety helmet.' },
    'chain-lock': { icon: '\u{1F512}', desc: 'Hardened steel lock for peace of mind.' },
    'led-light-set': { icon: '\u{1F4A1}', desc: 'Bright front and rear USB lights.' },
  };

  // Used ONLY in the labeled browser-only preview (index.html opened directly).
  const PREVIEW_PRODUCTS = [
    { id: 'trailblazer-mtb', name: 'Trailblazer Mountain Bike', priceCents: 1850000, stock: 8 },
    { id: 'velocity-road', name: 'Velocity Road Bike', priceCents: 2250000, stock: 6 },
    { id: 'streetkid-bmx', name: 'StreetKid BMX', priceCents: 1200000, stock: 10 },
    { id: 'aero-helmet', name: 'Aero Safety Helmet', priceCents: 150000, stock: 25 },
    { id: 'chain-lock', name: 'Heavy-Duty Chain Lock', priceCents: 80000, stock: 30 },
    { id: 'led-light-set', name: 'LED Light Set (Front + Rear)', priceCents: 45000, stock: 40 },
  ];

  const $ = (id) => document.getElementById(id);
  const money = (cents) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);

  let products = [];
  const basket = new Map(); // product id -> quantity
  let busy = false;

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    for (const c of children) node.append(c);
    return node;
  }

  function setMessage(text, kind) {
    const m = $('message');
    m.textContent = text || '';
    m.className = 'message' + (kind ? ' ' + kind : '');
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const findProduct = (id) => products.find((p) => p.id === id);

  // ---------- rendering ----------
  function renderProducts() {
    const list = $('product-list');
    list.replaceChildren();
    for (const p of products) {
      const meta = META[p.id] || { icon: '\u{1F6B2}', desc: '' };
      const inBasket = basket.get(p.id) || 0;
      const soldOut = p.stock === 0;
      const addBtn = el('button', {
        className: 'btn', type: 'button',
        textContent: soldOut ? 'Sold out' : 'Add to basket',
        disabled: soldOut || inBasket >= p.stock,
      });
      addBtn.addEventListener('click', () => addToBasket(p.id));

      const stockText = el('span', { textContent: p.stock + ' in stock' });
      if (p.stock > 0 && p.stock <= 5) stockText.className = 'low';

      list.append(
        el('article', { className: 'product' },
          el('div', { className: 'thumb', textContent: meta.icon, ariaHidden: 'true' }),
          el('div', { className: 'info' },
            el('h3', { textContent: p.name }),
            el('p', { textContent: meta.desc }),
            el('div', { className: 'meta' }, el('span', { className: 'price', textContent: money(p.priceCents) }), stockText)),
          addBtn)
      );
    }
  }

  function renderBasket() {
    const box = $('basket-items');
    box.replaceChildren();
    let totalQty = 0;
    let estimate = 0;

    for (const [id, qty] of basket) {
      const p = findProduct(id);
      if (!p) continue;
      totalQty += qty;
      estimate += qty * p.priceCents; // preview only; COBOL gives the real total
      const minus = el('button', { type: 'button', textContent: '−', ariaLabel: 'Decrease quantity of ' + p.name });
      const plus = el('button', { type: 'button', textContent: '+', ariaLabel: 'Increase quantity of ' + p.name, disabled: qty >= p.stock });
      const remove = el('button', { type: 'button', className: 'remove', textContent: 'Remove' });
      minus.addEventListener('click', () => changeQty(id, -1));
      plus.addEventListener('click', () => changeQty(id, +1));
      remove.addEventListener('click', () => { basket.delete(id); refresh(); });
      box.append(
        el('div', { className: 'line' },
          el('div', { className: 'line-top' }, el('span', { textContent: p.name }), el('span', { textContent: money(qty * p.priceCents) })),
          el('div', { className: 'line-bottom' },
            el('span', { className: 'stepper' }, minus, el('span', { textContent: String(qty) }), plus),
            remove))
      );
    }
    if (totalQty === 0) box.append(el('p', { className: 'empty', textContent: 'Your basket is empty.' }));

    $('basket-count').textContent = String(totalQty);
    $('basket-total').textContent = money(estimate);
    $('order-btn').disabled = totalQty === 0 || busy || isFilePreview;
  }

  function refresh() {
    renderProducts();
    renderBasket();
  }

  function applyProducts(data) {
    products = data.products;
    if (typeof data.itemsSold === 'number') $('items-sold').textContent = String(data.itemsSold);
    // Keep the basket valid against current stock.
    for (const [id, qty] of [...basket]) {
      const p = findProduct(id);
      if (!p || p.stock === 0) basket.delete(id);
      else if (qty > p.stock) basket.set(id, p.stock);
    }
    refresh();
  }

  function renderReceipt(data) {
    const body = $('receipt-body');
    body.replaceChildren();
    for (const it of data.items) {
      body.append(el('tr', null,
        el('td', { textContent: it.name }),
        el('td', { className: 'num', textContent: String(it.quantity) }),
        el('td', { className: 'num', textContent: money(it.unitPriceCents) }),
        el('td', { className: 'num', textContent: money(it.lineTotalCents) })));
    }
    $('receipt-total').textContent = money(data.totalCents);
    $('receipt').hidden = false;
    $('receipt').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- actions ----------
  function addToBasket(id) {
    const p = findProduct(id);
    if (!p) return;
    const have = basket.get(id) || 0;
    if (have >= p.stock) { setMessage('Only ' + p.stock + ' of ' + p.name + ' in stock.', 'error'); return; }
    basket.set(id, have + 1);
    setMessage('');
    refresh();
  }

  function changeQty(id, delta) {
    const p = findProduct(id);
    const next = (basket.get(id) || 0) + delta;
    if (next <= 0) basket.delete(id);
    else if (p && next <= p.stock) basket.set(id, next);
    refresh();
  }

  // "Place order": POST /api/checkout -> Node validates -> COBOL calculates.
  async function placeOrder() {
    if (busy || basket.size === 0) return;
    busy = true;
    $('order-btn').disabled = true;
    setMessage('Sending your order to the COBOL checkout...');
    const items = [...basket].map(([id, quantity]) => ({ id, quantity }));
    try {
      const data = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ items }) });
      basket.clear();
      applyProducts(data);
      renderReceipt(data);
      setMessage('Order placed. Stock updated.', 'ok');
    } catch (err) {
      setMessage(err.message, 'error');
      if (err.status === 409) {
        try { applyProducts(await api('/api/products')); } catch { /* keep current view */ }
      }
    } finally {
      busy = false;
      renderBasket();
    }
  }

  // "Reset stock": POST /api/reset
  async function resetStock() {
    try {
      basket.clear();
      $('receipt').hidden = true;
      applyProducts(await api('/api/reset', { method: 'POST' }));
      setMessage('Stock reset to starting values.', 'ok');
    } catch (err) {
      setMessage(err.message, 'error');
    }
  }

  // Header pill: GET /api/status (COBOL health check)
  async function checkStatus() {
    const pill = $('status-pill');
    if (isFilePreview) {
      pill.textContent = 'Browser-only preview';
      pill.className = 'pill pill-bad';
      return;
    }
    try {
      const s = await api('/api/status');
      pill.textContent = s.cobolConnected ? 'API + COBOL connected' : 'COBOL not connected';
      pill.className = 'pill ' + (s.cobolConnected ? 'pill-ok' : 'pill-bad');
    } catch (err) {
      pill.textContent = 'COBOL not connected';
      pill.className = 'pill pill-bad';
      setMessage('COBOL is not connected. Run "npm run build:cobol", then "npm start".', 'error');
    }
  }

  // ---------- start ----------
  async function init() {
    $('order-btn').addEventListener('click', placeOrder);
    $('reset-btn').addEventListener('click', resetStock);
    await checkStatus();
    if (isFilePreview) {
      $('preview-banner').hidden = false;
      $('reset-btn').disabled = true;
      applyProducts({ products: PREVIEW_PRODUCTS, itemsSold: 0 });
      return;
    }
    try {
      applyProducts(await api('/api/products'));
    } catch (err) {
      setMessage('Could not load products: ' + err.message, 'error');
    }
  }

  init();
})();
