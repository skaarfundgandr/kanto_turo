# Phase 7 Verification Matrix

**Scope:** frontend quality, accessibility, visual review, reproducibility, and delivery checks for the six core routes, including the Design2 admin and admin-only login update.

**Recorded:** 2026-08-10, from the frontend workspace. A `PASS` means the check was actually run in this workspace. `NOT RUN` records a dependency or capability boundary; it is not an assertion that the behavior passed.

**Gate status:** PASS for the changed-area automated gates and the recorded live Design2 login/admin viewport review. The repository-wide formatting baseline remains excluded as recorded below. End-to-end ordering, payment, physical QR, keyboard traversal, and the broader manual matrix remain outside this focused verification, so this is not a claim that every manual release scenario passed.

## Reproducible Workspace Checks

| Check                                     | Result  | Evidence or boundary                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install from the tracked lockfile         | PASS    | `bun install --frozen-lockfile` completed and updated no application source.                                                                                                                                                                                                         |
| Vitest/happy-dom unit and component suite | PASS    | `bun run test:unit`: 11 files and 174 tests passed, including six Phase 7 route audits and the safe seed-helper suite.                                                                                                                                                               |
| Six route axe-core audits                 | PASS    | `tests/phase7-accessibility.test.ts` audits menu, cart, checkout, receipt, login, and authenticated admin DOM, plus semantic names, form labels, table headers, status steps, and action labels.                                                                                     |
| Type and Svelte diagnostics               | PASS    | `bun run check`.                                                                                                                                                                                                                                                                     |
| ESLint and architecture rules             | PASS    | `bun run lint`.                                                                                                                                                                                                                                                                      |
| Changed-file Prettier formatting          | PASS    | Prettier was run and checked on the files changed by this branch. The repository-wide `bun run format:check` remains red on base-wide baseline files, so no repo-wide formatting pass is claimed.                                                                                    |
| Production build                          | PASS    | `bun run build`.                                                                                                                                                                                                                                                                     |
| Adapter-node deep-link smoke check        | PASS    | The portable PowerShell command below started and stopped `node build`; `/`, `/cart`, `/checkout`, `/login`, `/admin`, and `/order/42?exp=1700000000&sig=smoke-test` each returned HTTP 200. This checks server fallback only, not signed-link validity or backend data.             |
| Docker image build                        | NOT RUN | Docker is not installed or available on PATH in this workspace; no image result is claimed. Use the exact `docker build -t kanto-frontend:local .` command in the README on a Docker-enabled host.                                                                                   |
| Backend demo seed and object images       | PASS    | The already-running sibling API was seeded and verified with the idempotent helper: the `CUSTOMER` role, three categories, seven products/associations, and seven distinct Azure product images were present. This does not claim order, payment, QR, CORS, or signed-link coverage. |

The audit intentionally disables axe's `color-contrast` rule because happy-dom does not calculate rendered colors. The focused rendered contrast samples are recorded separately in the browser matrix below and are not attributed to axe. The `region` rule is also disabled when auditing an isolated route component rather than the full application shell.

The exact portable PowerShell command run from the repository root was:

```powershell
$env:HOST = '127.0.0.1'
$env:PORT = '4173'
$routes = @('/', '/cart', '/checkout', '/login', '/admin', '/order/42?exp=1700000000&sig=smoke-test')
$server = $null
try {
    $server = Start-Process -FilePath 'node' -ArgumentList @('build') -WorkingDirectory (Get-Location).Path -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 20 -and -not $ready; $attempt++) {
        if ($server.HasExited) { throw 'node build exited before the server became ready.' }
        try {
            $response = Invoke-WebRequest -Uri "http://$($env:HOST):$($env:PORT)/" -UseBasicParsing -ErrorAction Stop
            $ready = [int]$response.StatusCode -eq 200
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) { throw 'The adapter-node server did not become ready.' }
    foreach ($route in $routes) {
        $response = Invoke-WebRequest -Uri "http://$($env:HOST):$($env:PORT)$route" -UseBasicParsing -ErrorAction Stop
        [pscustomobject]@{ Route = $route; Status = [int]$response.StatusCode }
    }
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
        $server.WaitForExit()
    }
}
```

Recorded result:

```text
Route                                  Status
-----                                  ------
/                                          200
/cart                                      200
/checkout                                  200
/login                                     200
/admin                                     200
/order/42?exp=1700000000&sig=smoke-test    200
```

## Manual Browser, Accessibility, and Visual Matrix

| Area                 | Required review                                                                                                                                           | Result in this workspace | Truthful boundary                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Menu                 | Load live menu, choose category, add the same dish twice, and confirm the live quantity/total feedback                                                    | NOT RUN                  | Requires an interactive browser and running backend data.                                                                                                                                                                                                    |
| Cart                 | Edit quantity, remove a line, clear the slip, refresh, and confirm changed/missing catalog handling                                                       | NOT RUN                  | Requires an interactive browser and running backend data.                                                                                                                                                                                                    |
| Checkout             | Submit one isolated guest order, confirm one request, clear only after 201, and open the signed receipt                                                   | NOT RUN                  | Requires MySQL, backend, and a browser.                                                                                                                                                                                                                      |
| Receipt              | Reload a valid signed link, inspect server totals/status, copy the link, and verify the full QR payload                                                   | NOT RUN                  | Requires a real signed order and a browser; signed values were not fabricated.                                                                                                                                                                               |
| Payment success      | Use an order at or below `MAX_PAYMENT_AMOUNT`, confirm HTTP 200 body `payment_status: "paid"`, stamp, focus, and announcement                             | NOT RUN                  | Requires backend mock payment and a browser. Existing component tests cover the response and focus behavior without claiming a live result.                                                                                                                  |
| Payment failure      | Use an isolated order above `MAX_PAYMENT_AMOUNT`, confirm HTTP 200 body `payment_status: "failed"`, `HINDI TINANGGAP`, intact receipt, and retry behavior | NOT RUN                  | Requires backend threshold configuration/data and a browser.                                                                                                                                                                                                 |
| Admin login          | Direct-load `/admin` with no token, expired token, non-admin token, and valid admin token; verify no protected-content flash                              | PARTIAL PASS             | Live valid-admin login/admin rendering was reviewed; deterministic guard tests cover missing, expired, and non-admin credentials without claiming every live auth variant.                                                                                   |
| Admin board          | Filter, advance `Pending → Accepted → Ready → Completed`, pay, cancel, delete, confirm actions, and refresh                                               | PARTIAL PASS             | Live seeded products, filters, responsive ledger, menu images, and action target sizing were reviewed. Destructive order-action workflows were not exercised.                                                                                                |
| Ordering QR          | Display/download the authenticated SVG, inspect its exact public `/qr/visit` payload, follow the redirect to the frontend menu                            | NOT RUN                  | Requires backend QR endpoint, deployed or LAN-reachable URLs, and a browser/scanner.                                                                                                                                                                         |
| 390px visual         | Check menu, cart, checkout, receipt states, login, and admin for clipped controls or positive horizontal overflow                                         | PARTIAL PASS             | Live `/login` and `/admin` were reviewed at 390×844. The login actions were equal 324px full-width controls; the admin KPIs wrapped, filters remained usable, and the focusable ledger scrolled within its 341px client width without visible page overflow. |
| 1440px visual        | Compare the same routes with the Design2 composition, ledger, QR panel, and whitespace                                                                    | PARTIAL PASS             | Live `/login` and `/admin` were reviewed at 1440×1000. Login actions were equal 227×52px controls; the admin workspace, QR panel, menu grid, seven product rows, and seven natural-width 1024px images rendered as designed.                                 |
| Color contrast       | Measure text, controls, focus indicators, and status colors against WCAG contrast ratios in a rendered browser                                            | PARTIAL PASS             | Sampled rendered login/admin contrasts ranged from 5.8:1 to 16.58:1. This is not an exhaustive measurement of every route, state, or focus indicator.                                                                                                        |
| Keyboard             | Tab through navigation, category tabs, quantity controls, checkout, payment, filters, row actions, QR actions, and confirmations                          | PARTIAL PASS             | A visible focus outline was confirmed on a focused status button and semantic tests cover names/targets. Synthetic Tab did not advance in the in-app browser, so traversal order is not claimed.                                                             |
| Empty/error states   | Load empty menu/cart/order filters and retryable API, signed-link, login, and action errors; confirm names, focus, and recovery affordances               | PARTIAL PASS             | Existing component tests cover deterministic empty/error DOM and retry actions; manual browser and screen-reader review was not run.                                                                                                                         |
| Screen-reader names  | Review landmarks, headings, product/image alternatives, form labels, table headers, row actions, status steps, and QR names                               | PARTIAL PASS             | Automated route tests and existing component tests verify these DOM names; a real screen-reader session was not run.                                                                                                                                         |
| Focus                | Confirm visible focus, logical order, payment feedback focus, and no focus loss after retry/navigation                                                    | PARTIAL PASS             | A rendered status button showed the expected visible outline and receipt tests verify payment feedback focus; full keyboard order was not manually completed.                                                                                                |
| Reduced motion       | Enable `prefers-reduced-motion: reduce` and confirm entrance, bump, turo, polling feedback, and stamp do not create disruptive motion                     | PARTIAL PASS             | The rendered stylesheet rule that disables animation/transition was detected and the tracked guard is tested; the system preference itself was not enabled.                                                                                                  |
| 200% zoom            | Zoom to 200% and confirm controls, alerts, table/card equivalence, and QR actions remain usable                                                           | NOT RUN                  | Requires an interactive browser.                                                                                                                                                                                                                             |
| Overflow             | At 390px and 200% zoom, confirm no page-level horizontal scroll and no clipped action/QR panel                                                            | PARTIAL PASS             | `/login` and `/admin` had no visible page-level overflow at 390px and both ledgers contained their own horizontal scrolling. The 200% zoom check was not run.                                                                                                |
| Status announcements | Review order/payment live-region wording for initial, paid, failed, conflict-refresh, polling, and cancellation states                                    | PARTIAL PASS             | Existing tests cover `role="status"`, error alerts, mapping, payment outcomes, and focus; manual screen-reader announcement review was not run.                                                                                                              |

## Reproduction Notes

- The live browser review covered `/login` and `/admin` at 390×844 and 1440×1000 against the already-running local frontend/backend. It did not exercise destructive order actions.
- The six automated route checks are deterministic and mock every API/auth dependency.
- Any later live order/payment review must use isolated test orders and record the backend `MAX_PAYMENT_AMOUNT`, `ORDER_LINK_EXPIRATION_MINUTES`, `PUBLIC_API_BASE_URL`, `API_BASE_URL`, `ORDERING_BASE_URL`, and CORS origin used.
- Never paste a signed `exp`/`sig` query into screenshots, analytics, issue reports, or access logs.
- This record verifies the automated gates and focused Design2 admin/login acceptance above; rows still marked `NOT RUN` or `PARTIAL PASS` remain explicit boundaries.
