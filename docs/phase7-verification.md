# Phase 7 Verification Matrix

**Scope:** frontend quality, accessibility, visual review, reproducibility, and delivery checks for the six core routes.

**Recorded:** 2026-08-10, from the frontend workspace. A `PASS` means the check was actually run in this workspace. `NOT RUN` records a dependency or capability boundary; it is not an assertion that the behavior passed.

**Gate status:** PARTIAL, NOT RELEASE-VERIFIED. The deterministic workspace checks marked `PASS` below were run, but Phase 7 browser, MySQL/backend, and manual acceptance remain incomplete in this environment.

## Reproducible Workspace Checks

| Check                                     | Result  | Evidence or boundary                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install from the tracked lockfile         | PASS    | `bun install --frozen-lockfile` completed and updated no application source.                                                                                                                                                                                             |
| Vitest/happy-dom unit and component suite | PASS    | `bun run test:unit` is the configured suite; 10 files and 132 tests passed, including six Phase 7 route audits.                                                                                                                                                          |
| Six route axe-core audits                 | PASS    | `tests/phase7-accessibility.test.ts` audits menu, cart, checkout, receipt, login, and authenticated admin DOM, plus semantic names, form labels, table headers, status steps, and action labels.                                                                         |
| Type and Svelte diagnostics               | PASS    | `bun run check`.                                                                                                                                                                                                                                                         |
| ESLint and architecture rules             | PASS    | `bun run lint`.                                                                                                                                                                                                                                                          |
| Prettier formatting                       | PASS    | `bun run format` followed by `bun run format:check`.                                                                                                                                                                                                                     |
| Production build                          | PASS    | `bun run build`.                                                                                                                                                                                                                                                         |
| Adapter-node deep-link smoke check        | PASS    | The portable PowerShell command below started and stopped `node build`; `/`, `/cart`, `/checkout`, `/login`, `/admin`, and `/order/42?exp=1700000000&sig=smoke-test` each returned HTTP 200. This checks server fallback only, not signed-link validity or backend data. |
| Docker image build                        | NOT RUN | Docker is not installed or available on PATH in this workspace; no image result is claimed. Use the exact `docker build -t kanto-frontend:local .` command in the README on a Docker-enabled host.                                                                       |
| MySQL/backend seed and API smoke          | NOT RUN | This frontend-only verification session did not start MySQL or the sibling `arrow_server`; no order, auth, payment, QR, CORS, or signed-link HTTP result is claimed.                                                                                                     |

The audit intentionally disables axe's `color-contrast` rule because happy-dom does not calculate rendered colors; no color-contrast measurement was performed here. The `region` rule is also disabled when auditing an isolated route component rather than the full application shell. Semantic assertions remain in the test, while contrast, composed-shell landmarks, and rendered layout are listed as browser/manual checks below and are not represented as completed measurements.

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

| Area                 | Required review                                                                                                                                           | Result in this workspace | Truthful boundary                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Menu                 | Load live menu, choose category, add the same dish twice, and confirm the live quantity/total feedback                                                    | NOT RUN                  | Requires an interactive browser and running backend data.                                                                                       |
| Cart                 | Edit quantity, remove a line, clear the slip, refresh, and confirm changed/missing catalog handling                                                       | NOT RUN                  | Requires an interactive browser and running backend data.                                                                                       |
| Checkout             | Submit one isolated guest order, confirm one request, clear only after 201, and open the signed receipt                                                   | NOT RUN                  | Requires MySQL, backend, and a browser.                                                                                                         |
| Receipt              | Reload a valid signed link, inspect server totals/status, copy the link, and verify the full QR payload                                                   | NOT RUN                  | Requires a real signed order and a browser; signed values were not fabricated.                                                                  |
| Payment success      | Use an order at or below `MAX_PAYMENT_AMOUNT`, confirm HTTP 200 body `payment_status: "paid"`, stamp, focus, and announcement                             | NOT RUN                  | Requires backend mock payment and a browser. Existing component tests cover the response and focus behavior without claiming a live result.     |
| Payment failure      | Use an isolated order above `MAX_PAYMENT_AMOUNT`, confirm HTTP 200 body `payment_status: "failed"`, `HINDI TINANGGAP`, intact receipt, and retry behavior | NOT RUN                  | Requires backend threshold configuration/data and a browser.                                                                                    |
| Admin login          | Direct-load `/admin` with no token, expired token, non-admin token, and valid admin token; verify no protected-content flash                              | NOT RUN                  | Requires backend auth and a browser. Existing guard tests cover DOM gating and redirects with deterministic mocks.                              |
| Admin board          | Filter, advance `Pending → Accepted → Ready → Completed`, pay, cancel, delete, confirm actions, and refresh                                               | NOT RUN                  | Requires MySQL/backend state and a browser.                                                                                                     |
| Ordering QR          | Display/download the authenticated SVG, inspect its exact public `/qr/visit` payload, follow the redirect to the frontend menu                            | NOT RUN                  | Requires backend QR endpoint, deployed or LAN-reachable URLs, and a browser/scanner.                                                            |
| 390px visual         | Check menu, cart, checkout, receipt states, login, and admin for clipped controls or positive horizontal overflow                                         | NOT RUN                  | Requires browser viewport emulation or an interactive browser; no screenshot is claimed.                                                        |
| 1440px visual        | Compare the same routes with the Design2 composition, ledger, QR panel, and whitespace                                                                    | NOT RUN                  | Requires an interactive browser and the ignored Design2 reference material.                                                                     |
| Color contrast       | Measure text, controls, focus indicators, and status colors against WCAG contrast ratios in a rendered browser                                            | NOT RUN                  | No rendered browser measurement was performed; happy-dom does not calculate computed color contrast.                                            |
| Keyboard             | Tab through navigation, category tabs, quantity controls, checkout, payment, filters, row actions, QR actions, and confirmations                          | NOT RUN                  | Requires an interactive browser; DOM tests verify control names but not actual focus order.                                                     |
| Empty/error states   | Load empty menu/cart/order filters and retryable API, signed-link, login, and action errors; confirm names, focus, and recovery affordances               | PARTIAL PASS             | Existing component tests cover deterministic empty/error DOM and retry actions; manual browser and screen-reader review was not run.            |
| Screen-reader names  | Review landmarks, headings, product/image alternatives, form labels, table headers, row actions, status steps, and QR names                               | PARTIAL PASS             | Automated route tests and existing component tests verify these DOM names; a real screen-reader session was not run.                            |
| Focus                | Confirm visible focus, logical order, payment feedback focus, and no focus loss after retry/navigation                                                    | PARTIAL PASS             | Existing receipt tests verify payment feedback receives focus; visible-focus and full keyboard order were not manually run.                     |
| Reduced motion       | Enable `prefers-reduced-motion: reduce` and confirm entrance, bump, turo, polling feedback, and stamp do not create disruptive motion                     | PARTIAL PASS             | The tracked CSS/action guard is covered by existing tests; a browser media-preference session was not run.                                      |
| 200% zoom            | Zoom to 200% and confirm controls, alerts, table/card equivalence, and QR actions remain usable                                                           | NOT RUN                  | Requires an interactive browser.                                                                                                                |
| Overflow             | At 390px and 200% zoom, confirm no page-level horizontal scroll and no clipped action/QR panel                                                            | NOT RUN                  | Requires rendered browser layout; happy-dom cannot measure it.                                                                                  |
| Status announcements | Review order/payment live-region wording for initial, paid, failed, conflict-refresh, polling, and cancellation states                                    | PARTIAL PASS             | Existing tests cover `role="status"`, error alerts, mapping, payment outcomes, and focus; manual screen-reader announcement review was not run. |

## Reproduction Notes

- Browser automation is intentionally not part of this phase; Playwright remains deferred.
- The six automated route checks are deterministic and mock every API/auth dependency.
- Live browser results must use isolated test orders and record the backend `MAX_PAYMENT_AMOUNT`, `ORDER_LINK_EXPIRATION_MINUTES`, `PUBLIC_API_BASE_URL`, `API_BASE_URL`, `ORDERING_BASE_URL`, and CORS origin used.
- Never paste a signed `exp`/`sig` query into screenshots, analytics, issue reports, or access logs.
- This record is not a full Phase 7 pass or release verification: browser, MySQL/backend, and manual acceptance remain incomplete here.
