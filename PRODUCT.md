# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a walk-in diner at a Filipino turo-turo restaurant. They scan the
restaurant QR code, browse available dishes, build an order without creating an account, and
use the resulting signed receipt to follow payment and pickup progress.

Kusina staff are the operational users. Authorized administrators sign in to manage incoming
orders, move them through the kitchen workflow, maintain menu products and images, and present
the restaurant-wide ordering QR.

## Product Purpose

Kanto Turo-Turo connects an in-person diner directly to the kitchen through a guest-first QR
ordering flow. Success means a diner can confidently choose food, submit an accurate order,
retain a private trackable receipt, and understand when the order is ready, while staff can
process that same order from one protected board.

## Positioning

The defining mechanism is the complete QR-to-kitchen handoff: no-account ordering produces an
opaque signed receipt that remains useful through payment and pickup, while the restaurant
operates the corresponding order from a live Kusina board.

## Operating Context

- A diner enters from a restaurant-wide QR code or the public menu URL.
- The diner filters products by category, adds quantities to a persisted cart, reviews current
  product data, and checks out as a guest.
- The server creates the order and returns an opaque signed link; the receipt view polls order
  status, provides a QR and copy action, and supports the current mock-payment flow.
- Kusina staff authenticate through a separate admin-only login, monitor order KPIs and the
  ledger, advance exact kitchen statuses, and manage products and product images.
- The public experience is Filipino-first and uses familiar restaurant terms such as `ulam`,
  `turo`, and `Kusina`.

## Capabilities and Constraints

- Public ordering requires no customer account; `/login` is exclusively for Kusina
  administrators with the `ADMIN` permission.
- The server owns prices, totals, authorization, and order truth. Checkout sends only product
  identifiers and quantities, and the cart reconciles saved items against fresh product data.
- Backend order values remain exactly `Pending`, `Accepted`, `Ready`, `Completed`, and
  `Cancelled`; localized display labels must not change the values sent to the API.
- Signed order URLs are bearer-like opaque inputs. The client preserves `exp` and `sig`, does
  not generate or alter signatures, and must not expose signed URLs through logs, analytics,
  telemetry, screenshots, or support artifacts.
- Signed receipt reads and payment calls remain unauthenticated even when an admin token exists.
- Product images are optional and may use short-lived SAS URLs. URLs stay in memory, failed
  images receive one refresh attempt, and the interface retains an accessible missing-image
  state.
- Product creation and optional image upload are separate operations. A failed upload must not
  hide or resubmit a product that the server already created.
- Product editing and deletion, category editing and deletion, customer registration, and
  customer authentication are outside the current product.
- Network access stays inside `src/lib/api/client.ts`; the frontend uses the existing ARROW
  Server API rather than introducing a frontend proxy.

## Brand Commitments

- The product name is Kanto Turo-Turo; the staff workspace is called Kusina.
- Customer-facing language is Filipino-first, practical, warm, and direct. Technical language
  is reserved for details that help a user recover or an administrator understand access.
- Guest ordering and admin operations remain clearly separated without a customer/admin mode
  switch.

## Evidence on Hand

- The implemented routes cover the public menu, persisted cart, guest checkout, signed receipt
  and payment, Kusina login, order operations, ordering QR, and product/image management.
- The checked-in OpenAPI-generated contract and normalization layer define the supported API
  data and exact backend status values.
- Demo seed tooling provides three categories, seven products, their associations, and seven
  menu-image fixtures under `scripts/fixtures/menu/`; these are demonstration assets, not proof
  of production inventory.
- Deterministic unit, component, and axe-core accessibility coverage exists under `tests/`, with
  a verification record at `docs/phase7-verification.md`.
- No customer testimonials, production usage metrics, pricing policy, table-specific QR data,
  or deployment claims are available and future work must not fabricate them.

## Product Principles

1. Let diners order immediately without identity or account friction.
2. Preserve one trustworthy order from menu choice through kitchen pickup.
3. Treat signed links, server-owned totals, and role boundaries as product promises.
4. Make every asynchronous, partial, empty, and failure state understandable and recoverable.
5. Keep the diner experience local and human while keeping Kusina operations precise.

## Accessibility & Inclusion

All public and administrative workflows must remain keyboard-operable, screen-reader legible,
and understandable without relying on color alone. Loading, empty, error, permission, payment,
image, and status changes require explicit accessible feedback. The responsive web experience
must support diners using phones at the point of ordering as well as staff using larger kitchen
screens.
