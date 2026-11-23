'use strict';
/*
 * NazzGabbikes - Node.js API (middle layer)
 *   Browser UI  ->  this server  ->  compiled GnuCOBOL program (backend/shop)
 *
 * This file validates the request shape, sends the catalog, stock and
 * quantities to COBOL, and updates stock ONLY after COBOL returns a valid
 * result. All money/stock math is done by COBOL, never by JavaScript.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 4173;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const COBOL_BIN = process.env.COBOL_BIN || path.join(ROOT, 'backend', 'shop');
const SLOTS = 6; // must match OCCURS 6 in backend/shop.cbl

const CATALOG = [
  { id: 'trailblazer-mtb', name: 'Trailblazer Mountain Bike', priceCents: 1850000, startStock: 8 },
  { id: 'velocity-road', name: 'Velocity Road Bike', priceCents: 2250000, startStock: 6 },
  { id: 'streetkid-bmx', name: 'StreetKid BMX', priceCents: 1200000, startStock: 10 },
  { id: 'aero-helmet', name: 'Aero Safety Helmet', priceCents: 150000, startStock: 25 },
  { id: 'chain-lock', name: 'Heavy-Duty Chain Lock', priceCents: 80000, startStock: 30 },
  { id: 'led-light-set', name: 'LED Light Set (Front + Rear)', priceCents: 45000, startStock: 40 },
];

// In-memory inventory (resets when the server restarts).
let stock = {};
let itemsSold = 0;
function resetState() {
  stock = {};
  for (const p of CATALOG) stock[p.id] = p.startStock;
  itemsSold = 0;
}
resetState();

function productList() {
  return CATALOG.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, stock: stock[p.id] }));
}

// ---------- COBOL bridge ----------
class CobolUnavailable extends Error {}

function runCobol(inputLine) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(COBOL_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new CobolUnavailable(e.message));
    }
    let out = '';
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new CobolUnavailable('COBOL program timed out'));
    }, 5000);
    child.stdout.on('data', (d) => { out += d; });
    child.stdin.on('error', () => {});
    child.on('error', (e) => finish(reject, new CobolUnavailable(e.message)));
    child.on('close', (code) => {
      if (code !== 0) return finish(reject, new CobolUnavailable('COBOL program exited with code ' + code));
      finish(resolve, out.trim());
    });
    child.stdin.end(inputLine + '\n');
  });
}

const pad = (n, w) => String(n).padStart(w, '0');

// One fixed-width record per catalog product: +QQQQQQ PPPPPPPP SSSSSS
function buildRecord(qty, priceCents, stockNow) {
  return (qty < 0 ? '-' : '+') + pad(Math.abs(qty), 6) + pad(priceCents, 8) + pad(stockNow, 6);
}
function buildLine(mode, quantities) {
  let line = mode;
  for (let i = 0; i < SLOTS; i++) {
    const p = CATALOG[i];
    line += buildRecord(quantities[i] || 0, p.priceCents, stock[p.id]);
  }
  return line;
}

const UNAVAILABLE_HELP =
  'The compiled COBOL program is not available. Run "npm run build:cobol" and restart with "npm start". ' +
  'If cobc is missing, use Codespaces: Rebuild Container from the Command Palette.';

// ---------- helpers ----------
function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 10000) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch { reject(new Error('Request body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

// Serialize stock-changing work so two orders can never race each other.
let queue = Promise.resolve();
function serialize(fn) {
  const r = queue.then(fn);
  queue = r.catch(() => {});
  return r;
}

// ---------- routes ----------
async function handleStatus(res) {
  try {
    const out = await runCobol(buildLine('H', []));
    if (out !== 'OK|HEALTH') throw new CobolUnavailable('Unexpected COBOL reply: ' + out);
    sendJson(res, 200, { api: 'connected', cobolConnected: true });
  } catch (e) {
    sendJson(res, 503, { api: 'connected', cobolConnected: false, error: e.message, help: UNAVAILABLE_HELP });
  }
}

async function handleCheckout(req, res) {
  let body;
  try { body = await readJson(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return sendJson(res, 400, { error: 'Send { "items": [ { "id", "quantity" } ] } with at least one item.' });
  }

  // Validate request shape and merge duplicate ids.
  const wanted = new Map();
  for (const it of body.items) {
    if (!it || typeof it.id !== 'string') return sendJson(res, 400, { error: 'Every item needs a string "id".' });
    if (!CATALOG.some((p) => p.id === it.id)) return sendJson(res, 400, { error: 'Unknown product: ' + it.id });
    if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 999999) {
      return sendJson(res, 400, { error: 'Quantity must be a whole number of at least 1.' });
    }
    wanted.set(it.id, (wanted.get(it.id) || 0) + it.quantity);
  }
  const quantities = CATALOG.map((p) => wanted.get(p.id) || 0);
  if (quantities.some((q) => q > 999999)) return sendJson(res, 400, { error: 'Quantity too large.' });

  try {
    await serialize(async () => {
      const out = await runCobol(buildLine('C', quantities));
      const parts = out.split('|');

      if (parts[0] === 'ERR') {
        const code = (parts[1] || '').trim();
        const product = CATALOG[Number(parts[2]) - 1];
        if (code === 'STOCK') {
          const name = product ? product.name : 'an item';
          const left = product ? stock[product.id] : 0;
          return sendJson(res, 409, {
            error: 'Not enough stock for ' + name + ' (only ' + left + ' left).',
            code, productId: product && product.id,
          });
        }
        const msgs = {
          EMPTY: 'Your order has no items.',
          NEGQT: 'Quantities cannot be negative.',
          BADIN: 'Invalid order data.',
          MODE: 'Invalid request mode.',
        };
        return sendJson(res, 400, { error: msgs[code] || 'Order rejected by COBOL.', code });
      }

      if (parts[0] !== 'OK' || parts.length !== 1 + SLOTS + SLOTS + 1) {
        throw new CobolUnavailable('Unexpected COBOL reply: ' + out);
      }
      const nums = parts.slice(1).map(Number);
      if (nums.some((n) => !Number.isFinite(n))) throw new CobolUnavailable('Unreadable COBOL reply: ' + out);

      const remaining = nums.slice(0, SLOTS);
      const lineTotals = nums.slice(SLOTS, SLOTS * 2);
      const totalCents = nums[SLOTS * 2];

      // Only now (valid COBOL result) do we update stock.
      const items = [];
      CATALOG.forEach((p, i) => {
        if (quantities[i] > 0) {
          items.push({
            id: p.id, name: p.name, quantity: quantities[i],
            unitPriceCents: p.priceCents, lineTotalCents: lineTotals[i],
          });
          itemsSold += quantities[i];
        }
        stock[p.id] = remaining[i];
      });

      sendJson(res, 200, { items, totalCents, products: productList(), itemsSold });
    });
  } catch (e) {
    if (e instanceof CobolUnavailable) {
      return sendJson(res, 503, { error: e.message, help: UNAVAILABLE_HELP });
    }
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;
  try {
    if (route === '/api/status' && req.method === 'GET') return await handleStatus(res);
    if (route === '/api/products' && req.method === 'GET') {
      return sendJson(res, 200, { products: productList(), itemsSold });
    }
    if (route === '/api/checkout' && req.method === 'POST') return await handleCheckout(req, res);
    if (route === '/api/reset' && req.method === 'POST') {
      await serialize(async () => { resetState(); });
      return sendJson(res, 200, { products: productList(), itemsSold });
    }
    if (route.startsWith('/api/')) {
      const known = ['/api/status', '/api/products', '/api/checkout', '/api/reset'];
      return sendJson(res, known.includes(route) ? 405 : 404, { error: known.includes(route) ? 'Method not allowed' : 'Not found' });
    }
    const file = STATIC[route];
    if (file && req.method === 'GET') {
      const data = fs.readFileSync(path.join(ROOT, file[0]));
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
      return res.end(data);
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log('NazzGabbikes running on http://' + HOST + ':' + PORT);
  console.log('COBOL program: ' + COBOL_BIN);
});
