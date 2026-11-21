# Makoto Metal Technology, Inc. — Operations Console

Internal operations system for the MEPZ II plants of Makoto Metal Technology, Inc. in Basak, Lapu-Lapu City, Cebu. It covers inventory, preventive maintenance, production, purchasing, reporting, and administration for the die-casting, machining, and welding operations across both plants.

The UI is a TypeScript React single-page application built with Vite. The API and production file server run on Express and are written in TypeScript, compiled to `server-dist/` for production. Data is stored in a local SQLite database created and seeded on first start.

## Stack

- TypeScript 6 across the client, server, and tooling
- React 19 + React Router 7
- Vite 8 with the React plugin and Tailwind CSS 4 (utilities only; preflight disabled so the UI is unchanged)
- Express 5 (kept as the working API; no Laravel rewrite was needed for this hand-off)
- SQLite via Node's built-in `node:sqlite`
- ESLint 9 with `typescript-eslint`
- `tsx` for running the TypeScript server during development

## Requirements

- Node.js 22.12 or newer (Node 24 LTS recommended)

## Getting started

```bash
npm install
npm run build
npm start
```

Open <http://127.0.0.1:3000>.

The database is created automatically at `data/makoto.db` on first start and seeded with demo records.

### Development

Run the API and the Vite dev server together:

```bash
npm run dev
```

- UI with hot reload: <http://localhost:5173>
- API: <http://127.0.0.1:3000>

Vite proxies `/api` requests to the Express server on port 3000. You can run the two processes separately with `npm run dev:api` and `npm run dev:web`.

## Demo accounts

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | Plant Administrator |
| `manager` | `manager123` | Operations Manager |
| `maintenance` | `maintenance123` | Maintenance Staff |
| `user` | `user123` | Shop User |

Change the administrator password before using the system with real data.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Express API and Vite dev server together |
| `npm run dev:api` | Express API only, with `tsx watch` |
| `npm run dev:web` | Vite dev server only |
| `npm run typecheck` | Type-check the client, server, and Vite config |
| `npm run build` | Type-check, build the React app into `dist/`, and compile the server into `server-dist/` |
| `npm run build:server` | Compile the server TypeScript into `server-dist/` only |
| `npm start` | Serve the API and the built UI on port 3000 |
| `npm run preview` | Preview the Vite build |
| `npm run lint` | Run ESLint |
| `npm run reset` | Delete the SQLite database so the next start reseeds it (stop the server first) |

Set `PORT` or `HOST` to override the server defaults:

```bash
PORT=8080 HOST=0.0.0.0 npm start
```

Run the checks before handing off changes:

```bash
npm run typecheck
npm run lint
npm run build
```

`npm run build` also runs the type check. The client bundle is written to `dist/` and the compiled server to `server-dist/`.

## Modules

- **Dashboard** — plant overview, inventory value, low stock, production output, open work orders, machine status, attention items, and a prioritized **Recommended actions** panel.
- **Inventory** — item master, stock movements, warehouses, and plants. Movements update on-hand quantity and the ledger in one transaction.
- **Maintenance** — work orders, preventive schedules, machines, spare-part issuance, and completion with labor and downtime.
- **Production** — customer orders, target and completed quantities, scrap, achievement, and progress updates.
- **Purchasing** — purchase orders, line items, receiving into stock, suppliers, and customers.
- **Reports** — eight operational reports with summary cards, charts, print layout, and CSV export.
- **Administration** — user accounts, the activity log, company settings, and password changes.

### Analytics scope

The system presents three complementary business-analytics methods over the same live SQLite data. They are plain, rule-based views — no new data sources, external services, or machine-learning models are introduced, so nothing in the system changes.

- **Descriptive** — current stock value and low-stock exposure, stock movement history, production output and scrap by month, maintenance cost and downtime by machine, and purchase spend by supplier. These views answer *what happened and where we stand now*.
- **Predictive** — forward-looking estimates already calculated from those same records: **days of cover** from average daily usage, the **expected stockout window** from lead time plus a 7-day buffer, **due/overdue dates** on schedules and purchase orders, the **required daily production rate**, and the **maintenance risk score**. These answer *what is likely to happen next if nothing changes*. They are transparent estimates, not guarantees or AI forecasts.
- **Prescriptive** — the **Operations Action Plan** converts the descriptive signals and predictive estimates into a ranked to-do list with an owner area, a recommended action, a quantity or measure, and a target date. It answers *what should we do next*.

### Operations Action Plan

The plan is rebuilt on each request from live data and sorted by priority (`Critical`, `High`, `Normal`) and then by target date. It uses the descriptive signals and predictive estimates above, and combines four rule sets:

| Area | Trigger | Recommendation |
| --- | --- | --- |
| Inventory | On-hand quantity at or below the reorder point | Order a recommended quantity from the preferred supplier |
| Maintenance | Preventive schedule due within 30 days, overdue, or on a machine that is down | Raise or schedule a work order; risk score drives priority |
| Production | Open order where the required daily rate exceeds the current run rate | Increase output to the required rate, or recover an overdue schedule |
| Purchasing | Open purchase order past its expected delivery date | Follow up with the supplier and confirm a revised date |

The plan is available on the Dashboard (top six actions with priority counts) and as the **Operations Action Plan** report, which can be printed or exported to CSV.

**Recommended order quantity.** For each low-stock item, the system reads `OUT` stock movements from the last 90 days, converts them to an average daily usage, and adds the supplier's average lead time (from received purchase orders, defaulting to 14 days) plus a 7-day buffer. The target stock level is the larger of the reorder point doubled or that coverage requirement, and the recommended quantity is the gap between the target and the quantity on hand. Days of cover sets the priority: out of stock or seven days or less is `Critical`; below the reorder point or inside the lead time plus buffer is `High`; otherwise `Normal`.

**Maintenance risk score.** Each preventive schedule gets a 0–100 score: up to 50 points for overdue days, 25/15/5 points for due within 7/14/30 days, 40/20/5 points when the machine is in breakdown/under maintenance/idle, and up to 20 points for open work orders. A score of 60 or more is `Critical`, 30 or more is `High`, and the rest is `Normal`. The Low Stock and Maintenance Due reports expose the same usage, lead-time, days-cover, and risk columns so the recommendations can be audited.

## Roles

| Capability | Plant Admin | Operations Manager | Maintenance Staff | Shop User |
| --- | --- | --- | --- | --- |
| Sees in menu | Everything | Dashboard, Inventory, Maintenance, Production, Purchasing, Reports | Dashboard, Inventory, Maintenance, Reports | Dashboard, Inventory, Production |
| Dashboard focus | All actions + admin tools | Production, purchasing, stock actions | Machine and spare-part actions | Production output actions |
| Write inventory | Yes | Yes | No | No |
| Write maintenance | Yes | No | Yes | No |
| Write production | Yes | Yes | No | Yes |
| Write purchasing | Yes | Yes | No | No |
| Delete records | Yes | Yes | No | No |
| Reports | Yes | Yes | Yes | No |
| Users, settings, activity log | Yes | No | No | No |

Permissions are enforced by the API as well as reflected in the UI. Each login also has a different menu label, dashboard heading, role description, and three shortcut buttons, so the four personas behave like different jobs rather than renamed passwords.

## Project layout

```text
client/                 React application
  src/
    components/         Shell, tables, forms, modals, charts
    context/            Authentication and UI context
    lib/                API client, formatting, reference cache
    pages/              Dashboard, inventory, maintenance, production,
                        purchasing, reports, administration, login
    styles/app.css      Design system + Tailwind utilities (@apply)
    types.ts            Shared client API and domain types
  index.html
src/                    Express-side application code
  api.ts                API routing and domain rules
  auth.ts               Sessions, roles, and password hashing
  db.ts                 Schema, migrations, and typed SQLite facade
  resources.ts          Resource metadata driving tables and forms
  seed.ts               Demo data
  reset.ts              Database reset helper
  util.ts               Shared server helpers
data/makoto.db          SQLite database (created at runtime)
server.ts               Express API, static files, and SPA fallback
vite.config.mts         Vite configuration and API proxy
tsconfig.json           Client/server type-check configuration
tsconfig.server.json    Server build configuration (emits to server-dist/)
dist/                   Production React build (generated)
server-dist/            Compiled Express server (generated)
```

## Code tour for beginners

Read the code in this order. Each step answers one question.

1. **Which screens exist?** `client/src/App.tsx` — one `MODULES` entry per screen: its URL, permission and page component.
2. **What does a screen show?** `client/src/pages/*.tsx` — one file per module (Dashboard, Inventory, …).
3. **What is reused?** `client/src/components/` — the table, form, modal and shell used by every screen.
4. **How does a click reach the data?** `client/src/lib/api.ts` sends the request; `src/api.ts` checks the session and role, then runs the rule; `src/db.ts` talks to SQLite.
5. **Where are the business rules?** `src/api.ts` — low stock, reorder quantity, maintenance risk and the Action Plan.
6. **Where is the styling?** `client/src/styles/app.css` — the exact design lives here; Tailwind utilities are used with `@apply` for shared patterns, with preflight turned off.

A useful sentence to remember: *page → api.ts → db.ts → JSON → page*. Every feature follows that loop.

## Data and backup

The SQLite database lives at `data/makoto.db`. To back it up, stop the server and copy the file (and any `-wal` / `-shm` files). To restore the seeded demo data, run `npm run reset` and start the server again.

Uploaded files are not used; all document output is generated in the browser (print) or downloaded as CSV.

## Printing and exports

Report pages include a print header and footer from the company settings. Use the **Print** button for the browser print dialog and **Export CSV** for a spreadsheet-ready download. Receiving a purchase order writes inventory and ledger entries; exporting or printing never changes data.
