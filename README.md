# Kanto Turo-Turo Frontend

SvelteKit frontend for the Mini QR Ordering System. It serves the Design2-inspired Kanto Turo-Turo menu, guest order slip, signed receipt/payment flow, and authenticated Kusina order board against the sibling [ARROW Server](https://github.com/skaarfundgandr/arrow_server) API.

## Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer
- The sibling `arrow_server` checkout at `..\arrow_server` for live API work
- For live data: MySQL 8.x, Rust stable, and Diesel CLI with the MySQL feature
- Optional: Docker for the production image; Azure CLI and an Azure Container Registry for deployment

The unit/component suite uses Vitest and happy-dom, so it does not require MySQL, Azure Blob Storage, or a browser.

## Frontend Commands

Run these from this repository:

```powershell
bun install
bun run dev
bun run check
bun run lint
bun run format
bun run format:check
bun run test:unit
bun run build
bun run start
```

`bun run test` is an alias for the same Vitest suite. Use `bun run test:unit` or `bun run test`, not bare `bun test`: bare `bun test` invokes Bun's separate test runner and does not load the Vite aliases, Svelte transform, or happy-dom configuration used by this project.

The dev server is intentionally locked to `http://127.0.0.1:5173`. Production `start` runs the adapter-node output with `node build`; it honors `HOST` and `PORT`, defaulting to `0.0.0.0` and `3000` in the container.

## Frontend Environment

Create `.env` from `.env.example` when a non-default API is needed. Do not commit `.env` or real credentials.

| Variable              | Default                                            | Description                                                                                                      |
| --------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_API_BASE_URL` | `http://127.0.0.1:3000/api/v1`                     | Absolute `http`/`https` API URL ending exactly in `/api/v1`, with no query, hash, extra path, or trailing slash. |
| `HOST`                | adapter-node default; container sets `0.0.0.0`     | Listening host for `node build`; bind to all interfaces inside a container.                                      |
| `PORT`                | adapter-node default `3000`; container sets `3000` | Listening port exposed to local preview or Azure Container Apps.                                                 |

`PUBLIC_API_BASE_URL` is imported through SvelteKit's `$env/dynamic/public`, so the adapter-node deployment reads it from the running process/container environment. It is public client configuration, not a secret, and passing it only as a Docker build argument is not enough. An unset value uses the local default; a malformed value fails with a clear validation error. The generated client performs browser requests directly to this URL; there is no frontend proxy.

## Backend Setup

The backend repository is [skaarfundgandr/arrow_server](https://github.com/skaarfundgandr/arrow_server). Keep the two repositories as sibling directories.

### Direct backend setup

In `..\arrow_server`:

```powershell
Copy-Item .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, and QR_SIGNING_SECRET.
# Keep API_BASE_URL, ORDERING_BASE_URL, and CORS_ALLOWED_ORIGINS coordinated below.
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS test_db;"
diesel migration run
Get-Content .\seed.sql | mysql -u root -p test_db
cargo run
```

The database name in the example is illustrative; `DATABASE_URL` in `.env` must point to the database used by the commands. Install Diesel CLI once if needed:

```powershell
cargo install diesel_cli --no-default-features --features mysql
```

`seed.sql` is for a fresh/unseeded database and contains roles, categories, products, and category assignments. It does not contain an admin password.

### Reproducible demo seed

From this frontend repository, `bun run demo:seed` reads `DATABASE_URL` from the process environment or the sibling backend `.env`, runs sibling migrations, and applies the known seed only to an unseeded database. A complete seed is a clean no-op; a partial or conflicting seed fails instead of being silently overwritten. It never drops, truncates, or embeds credentials. The sibling backend still creates the admin from environment variables when it starts.

### Admin login

Set `ADMIN_USERNAME` (default `admin`) and a private `ADMIN_PASSWORD` in the backend `.env`. Start `arrow_server`, open the frontend `/login`, and use those environment-seeded values. No credential is stored in this repository or shown here.

### Two-terminal local workflow

Terminal 1, backend:

```powershell
cd ..\arrow_server
cargo run
```

Use these backend values for the local browser origin:

```dotenv
API_BASE_URL=http://127.0.0.1:3000
ORDERING_BASE_URL=http://127.0.0.1:5173/
CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173
```

Terminal 2, frontend:

```powershell
cd ..\cubetech_assessment
$env:PUBLIC_API_BASE_URL = 'http://127.0.0.1:3000/api/v1'
bun run dev
```

Use `127.0.0.1` consistently. `localhost` and `127.0.0.1` are different browser origins for CORS.

## Routes and API Behavior

| Frontend route                | Behavior                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`                           | Public categories/products menu and persisted cart bar.                                                                |
| `/cart`                       | Reconciles cart snapshots against fresh products; quantity, remove, clear, and checkout actions.                       |
| `/checkout`                   | Sends guest `{ products: [{ product_id, quantity }] }`; the server owns prices and totals.                             |
| `/order/{id}?exp=...&sig=...` | Reads and polls the opaque signed receipt link, generates a receipt QR, copies the full link, and offers mock payment. |
| `/login`                      | Logs in, hydrates the server user, and redirects only after `ADMIN` permission is confirmed.                           |
| `/admin`                      | Authenticated order filters, KPIs, pessimistic status/payment/cancel/delete actions, and ordering QR display/download. |

Public calls use `GET /products`, `GET /products/{id}`, `GET /categories`, category products, and guest `POST /orders` without `Authorization`. Signed receipt GET/pay also deliberately omit `Authorization`, even if an admin token is stored. Protected user, admin order, and QR calls require a Bearer token. Routes and stores do not call `fetch` directly.

The frontend preserves exact backend order statuses: `Pending`, `Accepted`, `Ready`, `Completed`, and `Cancelled`. The displayed copy is `Tinanggap`, `Niluluto`, `Handa na`, `Nakuha na`, and `Kinansela`; `Preparing` is never sent. Product SAS image URLs are rendered in memory only and are not persisted.

## Signed Links and Payment

- Treat `order_url` as bearer-like opaque input. The frontend parses and validates the order ID plus `exp`/`sig`, then copies both query values exactly; it never generates, edits, or logs a signature.
- Receipt GET/pay remain unauthenticated by design. Missing/partial credentials map to 403, tampering to 400, not found to 404, and expiry to 410 according to the backend contract.
- The document uses `Referrer-Policy: no-referrer`. Do not put signed URLs in analytics, logs, screenshots, support tickets, or telemetry; configure ingress access logs to omit or redact query strings.
- Mock payment returns HTTP 200 for both outcomes. At or below `MAX_PAYMENT_AMOUNT` (default `1000.00`) the body is `payment_status: "paid"`; above it the body is `payment_status: "failed"`. Already-paid orders return 409.
- The ordering QR is restaurant-wide. The authenticated backend QR encodes its public `/api/v1/qr/visit` URL, which redirects to `ORDERING_BASE_URL`; it is not table-specific.

## Design and Stack Decisions

SvelteKit 2 with strict TypeScript, Svelte stores, Bun, client-only rendering (`ssr = false`), and adapter-node keeps the browser/API boundary explicit. Plain scoped/global CSS ports the Design2 visual language without importing ignored mockup files, and bundled Fontsource packages avoid runtime font requests. OpenAPI-generated types are checked in and normalized into stable frontend DTOs. Vitest, Testing Library, happy-dom, and direct axe-core audits provide deterministic unit/component/accessibility coverage; Playwright browser automation is intentionally deferred. The backend remains the existing Rust/Axum/MySQL service rather than being duplicated in a frontend proxy.

## Troubleshooting

### CORS or failed preflight

Check that the browser origin is exactly `http://127.0.0.1:5173`, the frontend uses `http://127.0.0.1:3000/api/v1`, and the backend includes that origin in `CORS_ALLOWED_ORIGINS`. The backend preflight must allow `GET`, `POST`, `DELETE`, and `OPTIONS` plus `Authorization`, `Content-Type`, and `Accept`, with credentials disabled. Do not solve this with a Vite production proxy.

### Missing or expired Azure Blob image URLs

Product images are optional and SAS URLs are short-lived. Configure the backend Azure storage account/container and SAS-signing settings when image uploads/read SAS URLs are required. A missing or expired image is refetched once and then rendered as the accessible no-image slot; image URLs are never placed in cart localStorage.

### Expired or invalid receipt links

A 410 means the signed link expired; a 400 means its signature or order binding is invalid; a 403 means required signed query values are missing. Do not change `exp` or `sig` in a URL: changing either invalidates the HMAC and is not a valid expiry test. Obtain a new order link from a fresh order when needed.

### Direct route or container probe fails

Use adapter-node, not a static file server: run `bun run build`, set `$env:HOST = '0.0.0.0'; $env:PORT = '3000'`, then run `bun run start` or `node build`. Configure Azure Container Apps ingress target port `3000` and probe `/`. Adapter-node serves direct deep links such as `/cart`, `/checkout`, `/login`, `/admin`, and `/order/{id}`; no Vite dev server is required in production.

## Azure Container Apps Deployment

Build and smoke the same image locally on a Docker-enabled host:

```powershell
docker build -t kanto-frontend:local .
docker run --rm -p 3000:3000 `
  -e HOST=0.0.0.0 `
  -e PORT=3000 `
  -e PUBLIC_API_BASE_URL=https://api.example.com/api/v1 `
  kanto-frontend:local
```

For Azure Container Apps, push the image to an Azure Container Registry, grant the Container App identity `AcrPull`, and create/update the app with external ingress targeting port `3000`. A command shape using resource-name values is:

```powershell
az acr build --registry <acr-name> --image kanto-frontend:<tag> .
az containerapp create `
  --name <frontend-app> `
  --resource-group <resource-group> `
  --environment <container-app-environment> `
  --image <acr-name>.azurecr.io/kanto-frontend:<tag> `
  --registry-server <acr-name>.azurecr.io `
  --target-port 3000 `
  --ingress external `
  --env-vars HOST=0.0.0.0 PORT=3000 PUBLIC_API_BASE_URL=https://<backend-host>/api/v1
```

Use the platform's managed identity/secret reference for registry access rather than putting registry passwords in command history. Configure startup/liveness HTTP probes for `/` on port `3000`. `PUBLIC_API_BASE_URL` is dynamic runtime configuration in this implementation, so set it on every revision/container start and redeploy when the backend public URL changes.

Coordinate the backend before accepting traffic:

- Frontend `PUBLIC_API_BASE_URL` is `https://<backend-host>/api/v1`.
- Backend `API_BASE_URL` is `https://<backend-host>` and must produce an externally reachable `https://<backend-host>/api/v1/qr/visit` URL.
- Backend `ORDERING_BASE_URL` is the deployed frontend menu URL, normally `https://<frontend-host>/`.
- Backend `CORS_ALLOWED_ORIGINS` contains the exact frontend origin, with no path, and its allowed methods/headers include `GET, POST, DELETE, OPTIONS` and `Authorization, Content-Type, Accept`; credentials remain disabled.
- Backend and ingress/application access logs must omit or redact signed `exp`/`sig` query strings. The frontend has no request logger, and the backend application contract logs request paths rather than full signed URIs; verify the Azure/edge log configuration before exposing the app.

## Submission Note

At the Phase 7 check, `git remote -v` produced no output for this frontend repository. No frontend GitHub URL is invented or claimed; configure the user-owned remote and submission URL separately. The backend reference above is the public existing repository link.

## Verification Record

The tracked browser/a11y/visual result matrix is [`docs/phase7-verification.md`](docs/phase7-verification.md). It distinguishes deterministic workspace checks from browser, MySQL, backend, Azure, and physical QR checks that were not run here.
