# NazzGabbikes Project

A bike shop web app that follows this path:

**Browser UI → Node.js API → compiled GnuCOBOL checkout**

This is a demo only. It has no payment processing, customer accounts, or personal data. Inventory is held in the running Node process and resets when the server restarts.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/YOUR-GITHUB-USERNAME/NazzGabbikes)

> Replace `nazarreaGAB` in the badge link above with your GitHub username (edit this README on GitHub with the pencil icon).

## Start Here (GitHub Codespaces, no installs)

1. Open the repository on GitHub.
2. Click **Code → Codespaces → Create codespace on main**.
3. Wait for setup to finish. It installs Node.js and GnuCOBOL and compiles the COBOL program automatically.
4. In the Codespaces terminal, type `npm start` and press Enter.
5. Open port **4173** when Codespaces offers it, or select port 4173 in the **Ports** tab.

## If You Edit COBOL

After changing `backend/shop.cbl`, rebuild it before testing:

```bash
npm run build:cobol
```

Then restart the app with `npm start`. Check `GET /api/status` to confirm the compiled COBOL program is connected. If `cobc` is missing, use **Codespaces: Rebuild Container** from the Command Palette.

## Catalog

| Product | Price | Starting stock |
|---|---|---|
| Trailblazer Mountain Bike | ₱18,500.00 | 8 |
| Velocity Road Bike | ₱22,500.00 | 6 |
| StreetKid BMX | ₱12,000.00 | 10 |
| Aero Safety Helmet | ₱1,500.00 | 25 |
| Heavy-Duty Chain Lock | ₱800.00 | 30 |
| LED Light Set (Front + Rear) | ₱450.00 | 40 |

Adding an item changes only the basket. Stock changes after a successful checkout response.

## API Contract

- `GET /api/status` runs the compiled COBOL health check. Connected: `{"api":"connected","cobolConnected":true}`. If the executable is missing or fails, the API returns 503 with build instructions. It never replaces COBOL calculations with JavaScript.
- `GET /api/products` returns `{ "products": [{ "id", "name", "priceCents", "stock" }], "itemsSold" }`.
- `POST /api/checkout` accepts `{ "items": [{ "id": "trailblazer-mtb", "quantity": 2 }] }`.
- `POST /api/reset` restores the starting stock and returns the refreshed product list.
- A successful order returns receipt `items` (quantity and line total), updated `products`, and `totalCents`. Example: two Trailblazer Mountain Bikes → stock 6, total 3700000 cents (₱37,000.00).
- Invalid requests return **400**, stock conflicts return **409**, an unavailable COBOL executable returns **503**. Failed orders never change stock.

### Node ↔ COBOL record format

Node sends COBOL one fixed-width line (200 characters) on standard input: a mode letter (`H` health, `C` checkout) followed by **six** product records, one per catalog product. Each record is a signed six-digit quantity, an eight-digit unit price in cents, and a six-digit stock count. COBOL replies with one line:

- `OK|HEALTH`
- `OK|rem1..rem6|line1..line6|total` on success (remaining stock, line totals in cents, order total in cents)
- `ERR|CODE|nn` on failure (`STOCK`, `NEGQT`, `BADIN`, `EMPTY`, `MODE`; `nn` is the product number)

## Project Map

| Layer | File |
|---|---|
| UI | `index.html`, `styles.css`, `app.js` |
| API | `server.js` |
| COBOL checkout | `backend/shop.cbl` |
| Build scripts | `scripts/build-cobol.sh`, `scripts/setup.sh` |
| Codespaces setup | `.devcontainer/devcontainer.json` |

## How each UI feature reaches COBOL (for the class demo)

| What you see | Triggered in | Backend path | COBOL involvement |
|---|---|---|---|
| Green "API + COBOL connected" pill | `checkStatus()` in `app.js` | `GET /api/status` → `handleStatus()` in `server.js` | Runs `shop` with mode `H`; `MAIN-PARA` replies `OK\|HEALTH` |
| Product list with price and stock | `init()` → `renderProducts()` | `GET /api/products` | None (reads in-memory stock) |
| **Add to basket** / `+` / `−` / Remove | `addToBasket()`, `changeQty()` | None. The basket lives in the browser only | None |
| Estimated total | `renderBasket()` | None. This is only a preview | None |
| **Place order** | `placeOrder()` | `POST /api/checkout` → `handleCheckout()` | `VALIDATE-PARA` (numbers, no negatives, no oversell, not empty), `CALCULATE-PARA` (line totals, remaining stock, order total), `RESPOND-PARA` |
| Receipt (order total) | `renderReceipt()` | Values come from the COBOL reply | Totals are calculated by COBOL |
| Error message (e.g. not enough stock) | `placeOrder()` catch | 409 from `handleCheckout()` | `VALIDATE-PARA` returns `ERR\|STOCK\|nn` |
| Total items sold | `applyProducts()` | Counter in `server.js`, increased only after a valid COBOL result | Quantities come from a successful COBOL order |
| **Reset stock** | `resetStock()` | `POST /api/reset` | None |

## Try it

1. Add 2 Trailblazer Mountain Bikes and click **Place order**. COBOL returns total ₱37,000.00 and stock goes from 8 to 6.
2. Add more bikes than are in stock. The API returns 409 and the stock does not change.
3. Click **Reset stock** to start again.
