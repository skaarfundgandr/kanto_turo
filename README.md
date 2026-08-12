# Kanto Turo-Turo Frontend

SvelteKit frontend for the Mini QR Ordering System. It provides the Kanto Turo-Turo menu, guest cart and checkout flow, signed order receipt and payment screens, and the authenticated Kusina order board.

The frontend consumes the [Arrow Server API](https://github.com/skaarfundgandr/arrow_server/).

## Prerequisites

- [Bun](https://bun.sh/) 1.3 or newer
- A running Arrow Server API for live data
- MySQL, Rust, and Diesel CLI only when operating the API locally
- Docker and Azure tooling only when deploying the frontend

The unit and component tests use Vitest and happy-dom, so they do not require a running API, database, object storage, or browser.

## Commands

Run these from the repository root:

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

Use `bun run test:unit` or `bun run test` for the configured Vitest suite. Do not use bare `bun test`; it invokes Bun's separate test runner without this project's Vite, Svelte, and happy-dom configuration.

The development server uses `http://127.0.0.1:5173`. The production adapter-node server honors `HOST` and `PORT`.

## Configuration

Copy `.env.example` to an environment file for local overrides. Keep credentials, bearer tokens, SAS URLs, and signed order URLs out of version control.

| Variable              | Default                        | Description                                                                                       |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `PUBLIC_API_BASE_URL` | `http://127.0.0.1:3000/api/v1` | Absolute API URL ending exactly in `/api/v1`, with no query, hash, extra path, or trailing slash. |
| `HOST`                | Adapter-node default           | Host used by the production server.                                                               |
| `PORT`                | `3000`                         | Port used by the production server.                                                               |

`PUBLIC_API_BASE_URL` is public runtime configuration, not a secret. The generated API client sends browser requests directly to this URL; the frontend does not proxy API traffic. HTTP is intended for loopback development addresses, while remote APIs should use HTTPS.

For a local frontend/API workflow, configure the API to allow the frontend origin `http://127.0.0.1:5173`, then run:

```powershell
$env:PUBLIC_API_BASE_URL = 'http://127.0.0.1:3000/api/v1'
bun run dev
```

Use `127.0.0.1` consistently. `localhost` and `127.0.0.1` are different browser origins for CORS.

## Project Structure

- `src/routes/`: application routes and route layouts
- `src/lib/components/`: reusable Svelte components
- `src/lib/api/`: API client, generated types, endpoint wrappers, and authentication helpers
- `src/lib/stores/`: cart and authentication state
- `src/lib/utils/`: domain utilities for money, order links, receipts, polling, and statuses
- `src/lib/design/`: shared design tokens and global styles
- `static/`: static assets
- `scripts/`: API type synchronization and demo data helpers
- `scripts/fixtures/`: tracked demo image fixtures
- `tests/`: Vitest and Testing Library suites
- `docs/`: repository verification notes

Network access belongs in `src/lib/api/client.ts`. Routes and components use the API wrappers rather than calling `fetch` directly.

## Routes

| Route                         | Behavior                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `/`                           | Public categories and products menu with a persisted cart bar.                          |
| `/cart`                       | Cart reconciliation, quantity changes, removal, clearing, and checkout navigation.      |
| `/checkout`                   | Guest order submission; the API owns prices and totals.                                 |
| `/order/{id}?exp=...&sig=...` | Signed receipt lookup, polling, receipt QR generation, and mock payment.                |
| `/login`                      | Admin-only login and server-user hydration.                                             |
| `/admin`                      | Protected order board, KPIs, status actions, ordering QR, and product image management. |

Public product, category, guest-order, and signed-receipt requests do not use an authorization token. User, admin-order, QR, product-creation, and product-image mutation requests require a bearer token.

The frontend preserves the API's order statuses: `Pending`, `Accepted`, `Ready`, `Completed`, and `Cancelled`. Product image URLs are short-lived values rendered in memory and are not persisted in the cart.

## Signed Links and Payments

- Treat `order_url` as opaque bearer-like input.
- Preserve the `exp` and `sig` query values exactly; do not generate, edit, or log signatures.
- Receipt and payment requests are unauthenticated by design.
- Do not place signed URLs in analytics, logs, screenshots, support tickets, or telemetry.
- Mock payment returns `paid` or `failed` according to the API's configured amount threshold; already-paid orders return a conflict.

## Verification

Run the full local checks before submitting changes:

```powershell
bun run check
bun run lint
bun run format:check
bun run test:unit
bun run build
```

The repository's verification record is [`docs/phase7-verification.md`](docs/phase7-verification.md). It records which automated and manual checks were actually run and identifies checks requiring external services or interactive browser capabilities.

## Deployment

Build and run the adapter-node image on a Docker-enabled host:

```powershell
docker build -t kanto-frontend:local .
docker run --rm -p 3000:3000 `
  -e HOST=0.0.0.0 `
  -e PORT=3000 `
  -e PUBLIC_API_BASE_URL=https://api.example.com/api/v1 `
  kanto-frontend:local
```

For a hosted deployment, expose port `3000`, configure `PUBLIC_API_BASE_URL` at runtime, and set the API's CORS allowlist to the exact deployed frontend origin. Configure health probes against `/` and redact signed query values from platform and ingress logs.
