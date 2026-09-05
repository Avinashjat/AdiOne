# AdiOne — Implementation Progress Tracker

Persistent task tracker across Claude Code sessions.
Source of truth for scope: [AdiOne_ClaudeCode_TaskList.md](AdiOne_ClaudeCode_TaskList.md)

**Rules of engagement**
- Tasks are executed strictly in order. No skipping, no combining.
- Before starting a task, the task number + title is announced.
- After finishing a task, this file is updated (status + one-line note), changes are shown, then work STOPS for go-ahead.
- If a task depends on an unconfirmed decision, work stops and the question is asked first.

**Status legend:** `Not Started` · `In Progress` · `Done` · `Blocked` · `Skipped`

**Overall:** 69 / 71 tasks Done. **126 tests passing** (37 unit, 85 integration,
4 end-to-end) against real PostgreSQL.
- **Backend complete** (Phases 0–12), verified running, 122 tests passing.
- **Admin panel complete** (Phase 13), builds and verified against the live API.
- **Mobile app: all core screens built** (Tasks 14.1–14.14), typechecks clean.
  **Not yet run on a device** — that is the outstanding verification.
- **Production packaging done** (Task 17.1–17.3): Dockerfiles, prod compose
  with nightly backups, deployment guide with a restore drill.

- **Navigation fully wired** (Phase 15) — per-tab stacks, checkout → tracking,
  account → orders/addresses, socket lifecycle tied to the session.

**Remaining:** Task 14.15 (Refer & Earn — flag-disabled by decision O6, screen
not built), 14.16 (dedicated error screens; shared `ErrorState`/`EmptyState`
already cover most cases), Phase 16 (mobile + E2E tests), and **running the
app on a device** — the outstanding verification.

**Mode:** running continuously without per-task approval, per user instruction
(2026-08-14). Decisions are taken using the recommendations recorded in
[docs/02-decisions.md](docs/02-decisions.md).

---

## Phase 0 — Architecture & Planning (no code)

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 0.1 | Complete PRD + architecture document | Done | [docs/01-PRD-and-Architecture.md](docs/01-PRD-and-Architecture.md). Key calls: `store_variants` merges store-scoped price+stock; adjacency-list category tree instead of a separate Subcategories table; money as integer paise; 3-state COD policy, most-restrictive-wins; internal state machine decoupled from the 5-step customer timeline. 12 conflicts found between the spec and the mockups, 11 missing requirements identified. |
| 0.2 | Three-project skeleton + shared-contract sync + docker-compose | Done | **Restructured from monorepo to three independent folders** (`backend/`, `web/`, `mobile/`) per user direction. Shared contract lives in `backend/src/shared/` and is mirrored by `backend/scripts/sync-shared.mjs` (with a `--check` CI gate). Root `.gitignore`, `README.md`, `docker-compose.yml` (Postgres/Redis/MinIO, optional). `backend/.env.example` documents every key; real `JWT_SECRET`/`OTP_PEPPER` generated. |
| 0.3 | Backend base (Express 5 + TS, env loader, error handler, logger, health) | Done | Fail-fast env validation that also **refuses to boot in production with a dev stub** (console OTP / mock payments / memory cache / local storage). Pino logger with PII redaction + request-id via `AsyncLocalStorage`. Centralised error handler mapping `AppError`/Zod/Prisma to the stable wire envelope. `/health` (liveness) and `/health/ready` (DB + cache). Graceful shutdown. **Verified running:** all endpoints return correct envelopes. |

## Phase 1 — Database & Core Config

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 1.1 | Confirm open decisions | Done | [docs/02-decisions.md](docs/02-decisions.md) — O1–O12 locked with rationale and reversibility, plus 15 implementation decisions (D1–D15). No blocking questions asked, per instruction. |
| 1.2 | PostgreSQL schema + migrations + indexes | Done | 30 models, 4 migrations applied. Partial indexes, `CHECK` constraints, tsvector + trigram search in a hand-written `hardening` migration. **Found and fixed a real bug:** `UNIQUE(key, store_id)` does not constrain global rows because SQL treats NULL as distinct — added partial unique indexes for the NULL scope on `configurations` and `categories`. **Constraints proven working** by attempting violations. |
| 1.3 | Configuration module | Done | Typed `get`/`getMany`/`getAll`/`getPublic`/`set` with 60 s cache, store-override precedence, strict value validation, and `GET /api/v1/config/public`. `CONFIG_DEFAULTS` is the only place the literal `10` (km radius) appears. |
| 1.4 | Seed data | Done | Reference tier (config, store, hours, 14 categories, admin) runs everywhere; demo tier (15 brands, 17 products, 29 variants+offers, 3 coupons, 2 agents) is skipped in production. **Idempotent — verified by re-running.** Seed never overwrites a config value an owner has tuned. |

## Phase 2 — Auth Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 2.1 | `POST /auth/send-otp` | Done | `OtpProvider` port (`console` dev stub / `msg91`). OTP generated with `crypto.randomInt`, stored as `HMAC-SHA256(code, OTP_PEPPER)` — never plaintext. Three stacked limiters: 3/hour + 10/day per mobile, 10/hour per IP, plus a resend cooldown. Validation runs **before** the per-mobile limiters so `+91 98765 43210` and `9876543210` share one counter. |
| 2.2 | `POST /auth/verify-otp` | Done | Constant-time compare, server-side attempt counting (code destroyed after 5), single-use on success. First successful verification creates the account (201) and allocates a referral code; thereafter logs in (200). Expired and never-requested are deliberately indistinguishable. |
| 2.3 | Auth middleware, refresh, logout, RBAC | Done | JWT access (15 min, HS256, `algorithms` pinned) + opaque refresh stored **hashed** with a family id, rotated every use, with **reuse detection** that revokes the whole family. `authenticate` / `optionalAuthenticate` / `requirePermission` / `requireRole` / `requireAdmin`. Ownership checks deliberately kept in services, not middleware. Admin login by email+password (bcrypt cost 12) with one generic error so the endpoint is not an account-existence oracle. |
| 2.4 | Auth tests | Done | 23 integration + 37 unit. Covers normalisation, hashed storage, cooldown, rate limits, wrong/expired/exhausted/replayed OTP, session rotation, reuse-detection family revocation, logout, blocked accounts, admin-login oracle resistance, and that `mobile` cannot be changed via `PATCH /me`. |
| 2.5 | `POST /auth/login` (email + password) | Done | Works for customers **and** staff; `/auth/admin/login` is the same path with an added staff-role requirement, so a customer with valid credentials cannot enter the store panel. One identical error for unknown-email / no-password / wrong-role / wrong-password, plus a **dummy bcrypt comparison on the miss path** so response timing does not enumerate accounts. Two limiters: 8/15 min per email (dictionary attack on one account) and 40/15 min per IP (credential stuffing across many). |
| 2.6 | `POST /auth/signup` (name + email + password + mobile) | Done | Returns 201 with tokens — logged in immediately, no second step. Password policy: ≥8 chars with a letter and a digit. Mobile normalised before storage and before rate-limiting. **Added `users.mobile_verified_at`** — a typed number is not a proven one, so password signup leaves it null and one OTP login clears it (`mobileVerified` is on `UserDto` so the app can prompt before checkout). Duplicate email/mobile return specific, actionable errors — unlike login, a signup form must say which field clashed. 5 signups/hour per IP, 3/hour per mobile. |

## Phase 3 — Location & Serviceability Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 3.1 | `calculateDistance()` + `checkServiceability()` | Done | Pure functions in `shared/distance.ts`; `store.service.ts` wires them to `MAX_SERVICE_RADIUS_KM` from Configuration, with an optional per-store override. Straight-line decides serviceability; `ROAD_DISTANCE_FACTOR` prices ETA and delivery fee. **Test proves the radius comes from config** — same coordinates flip when the row changes. |
| 3.2 | `GET /store/serviceability?lat=&lng=` | Done | One round trip returns serviceable, distanceKm, maxRadiusKm, ETA band, delivery fee and storeOpen. Public (no auth) so an out-of-area customer isn't forced to register first. ETA/fee are `null` when not serviceable. `0,0` (failed Android GPS fix) is rejected as invalid input rather than reported as "out of area". |
| 3.3 | `isStoreOpen()` | Done | Evaluated in `stores.timezone`, not server UTC — verified by a test at 05:00 IST (23:30 UTC previous day). Handles windows crossing midnight and `store_closures` holidays. `assertStoreAcceptingOrders` gates checkout, overridable by `ALLOW_ORDERS_WHEN_CLOSED`. |

## Phase 4 — Catalog Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 4.1 | `GET /categories`, `/categories/:id/subcategories` | Done | Self-referencing tree with a 60 s cache (used to resolve COD chains without a query per product). Live product counts for the sidebar. |
| 4.2 | `GET /products`, `GET /products/:id` | Done | **Keyset** pagination (stable while the catalogue is edited, unlike OFFSET). Product IDs resolved in SQL — where `stock_qty - reserved_qty` can be compared and the partial in-stock index applies — then hydrated by Prisma. Price/discount/stock/COD/qty-limit all resolved live from `store_variants` at read time. Plus `GET /home` (one round trip for the whole Home screen) and `/products/:id/related`. |
| 4.3 | `GET /products/search?q=` | Done | Behind `SearchProvider`. Postgres FTS over name + Hindi name + local keywords, OR'd with trigram `word_similarity`. **Verified live:** `cheeni` → Madhur Sugar, `colgat` → Colgate. |
| 4.4 | Admin catalog CRUD + image upload | Done | `StorageProvider` port (`local` dev / S3-compatible with hand-rolled SigV4 presigning — no 15 MB AWS SDK). Renaming a category rewrites the whole descendant `path` subtree in one transaction. Publishing a product requires at least one priced variant. Nothing order-referenced is hard-deleted. Every mutation writes an audit row. |

## Phase 5 — Inventory Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 5.1 | Inventory service | Done | `setStock` refuses to go below `reserved_qty` (that stock is promised to paying customers — a human decision, not a silent clamp). `markOutOfStock` flips availability rather than zeroing stock, so the shelf count and sellability stay separately auditable. Low-stock report uses the partial index. |
| 5.2 | Stock-reservation primitive | Done | `lockOffersForUpdate` — `SELECT … FOR UPDATE ORDER BY variant_id`. The deterministic lock order is what prevents deadlock between two carts containing the same items in opposite order. Reserve → commit → release → restock, each writing a `stock_ledger` row. |

## Phase 6 — Cart Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 6.1 | Cart CRUD | Done | Variant = line item. Add is a single `ON CONFLICT` upsert on `(cart_id, variant_id)`, so a double-tap cannot race. Ownership checked in the service, not the route guard. |
| 6.2 | Server-side revalidation | Done | Runs on **every** read — no fast path. Corrects the cart AND returns `changes[]` so the app can say "Tata Salt is out of stock and was removed" rather than the total silently moving at the payment screen. A test asserts `cart_items` has no price column at all. |

## Phase 7 — Address Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 7.1 | Address CRUD | Done | Max-5 from config. `area` required, house/street optional — "Near Shiv Mandir, Main Road" often *is* the address here. First address auto-defaults; deleting the default promotes the next one so checkout always has something to preselect. |
| 7.2 | Serviceability validation | Done | Recomputed on save and whenever the pin moves. Out-of-area addresses are **saved but not orderable** — refusing to store a parents' address teaches users the app is broken. |

## Phase 8 — Order Module & Checkout

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 8.1 | Order state machine | Done | `transitionOrder` is the **only** code that writes `orders.status`. Locks the order row `FOR UPDATE`, validates transition *and* actor, writes history, and performs the stock/payment side effects in the same transaction. Two admins clicking Accept simultaneously → one wins. |
| 8.2 | `POST /orders` | Done | One transaction: store open → address ownership → serviceability → **lock inventory** → per-item availability/qty → price from locked rows → COD → coupon (re-validated inside) → totals → min order → reserve → create → convert cart. Third-party calls never inside. **Proven: 10 concurrent buyers, 1 unit → exactly 1 order.** Idempotency via `UNIQUE(user_id, key)` with stored response replay. |
| 8.3 | COD precedence resolver | Done | Full leaf-to-root category chain, most-restrictive-wins, snapshotted per line into `order_items.allow_cod_resolved`. Test sets a *category* to DENY and asserts the order is blocked **and names the item** — zero category names in code. |
| 8.4 | `GET /orders`, `GET /orders/:id` | Done | Timeline built from `order_status_history`, mapped to the mockup's 5 customer steps. Address rendered from the order's **snapshot**, not the (possibly edited) saved address. `canCancel` from `CANCELLATION_ALLOWED_UNTIL`. |
| 8.5 | ETA | Done | `estimateDeliveryTime` wired to config incl. live store workload; stored on the order as `eta_minutes` + `promised_at` so the promise is auditable. |

## Phase 9 — Payments Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 9.1 | Payment-provider abstraction + concrete provider | Done | `PaymentProvider` port with `razorpay` and `mock`. The mock signs **real HMACs over the same fields Razorpay uses**, so tests exercise the verification code path rather than stubbing it. Razorpay called over `fetch` — no 15 MB SDK. UPI/Card/PhonePe/GPay/Paytm = **one** integration (PSP checkout methods), not five. |
| 9.2 | create / verify / webhook | Done | Three convergent paths (client verify, signed webhook, reconciliation job) into **one idempotent handler**. `/verify` re-queries the provider — a client-reported success alone never confirms. Webhook HMAC over the **raw body** (raw parser mounted above `express.json`). Replay-guarded by `UNIQUE(provider, event_id)`. **Amount cross-checked against `orders.total_paise`** — a mismatch is logged with its error code and never auto-confirmed. |
| 9.3 | Refunds | Done | Auto-refund on admin cancel/reject of a paid order. Refund + payment + order status move in one transaction. Failures recorded with a reason for manual follow-up rather than silently swallowed. |

## Phase 10 — Delivery Module (backend-only in V1)

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 10.1 | Agents CRUD + manual assignment | Done | Reassignment **cancels** the old assignment rather than editing it, so the record of who held a parcel survives — that is what settles a cash dispute. Deleting an agent is refused while they hold live orders. Day-end cash-to-collect report per rider. |
| 10.2 | Delivery-app backend contract | Done | Designed, not built: `delivery_agents.user_id`, the ASSIGNED→ACCEPTED→PICKED_UP→DELIVERED ladder and the `DELIVERY_AGENT` role all exist, so the V2 rider app needs no schema change. |

## Phase 11 — Notifications Module

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 11.1 | Notification abstraction | Done | `NotificationProvider` port (`console` / `fcm`). The `notifications` table is both the **outbox** and the in-app feed, so a failed push is retried from the row rather than lost. `notify()` never throws into the caller — a push gateway outage must not fail an order. |
| 11.2 | Triggers wired into the state machine | Done | Dispatched **after commit**, never inside the transaction holding inventory locks. Copy is short and concrete per event. Device tokens upserted on the token so a reinstall moves it instead of pushing a stranger's order updates. |

## Phase 12 — Real-time Order Status

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 12.1 | Socket.IO | Done | Shares the HTTP server (one port, one TLS termination). JWT-authenticated on handshake — an expired token cannot subscribe. Only staff may join a store room. **Polling fallback on both clients**: realtime is an optimisation, never the only path, so a dropped socket can never lose an order. Polling-first transport because some Indian networks block websocket upgrades. |

## Phase 13 — Admin Web Panel

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 13.1 | Scaffold, login, routes, shared UI | Done | React 18 + Vite + TS + TanStack Query + Tailwind. **Access token in memory only** (an XSS must not hand over a session that can issue refunds); refresh token persisted with single-flight rotation so concurrent 401s share one refresh. Login uses `/auth/admin/login`, so a customer with valid credentials is refused. Build: 278 KB / **87 KB gzipped**. |
| 13.2 | Dashboard | Done | Today's orders/sales in the **store's** local day, orders by status, low stock. 30 s poll. |
| 13.3 | Orders board | Done | 7 tabs, one-click accept, **repeating audible chime until acknowledged** (WebAudio — no asset, no autoplay block), red left edge on orders waiting ≥5 min, rider assignment inline, COD delivery prompts for the customer's OTP. **Polls every 20 s in addition to the socket** — realtime is an optimisation, never the only path. |
| 13.4 | Products & inventory | Done | Optimised for the edit made twenty times a day (stock/price), not for product creation. Commits on blur, not per keystroke. Zero stock shown in red. |
| 13.5 | Delivery management | Done | Agent CRUD, availability toggles, and the day-end **cash-to-collect report per rider**. |
| 13.6 | Configuration | Done | All 32 keys, grouped by topic, edited in the browser. **Verified end-to-end:** changing `MAX_SERVICE_RADIUS_KM` to 12 immediately surfaced on `GET /config/public` — no redeploy, which is the whole point of the configuration table. |

## Phase 14 — Customer Mobile App (React Native)

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 14.1 | Design system | Done | Expo + React Navigation + Zustand + TanStack Query. Components built to the brief's constraints: **16pt body text** (small type is the most common accessibility failure in Indian consumer apps), 48pt minimum touch targets, pill buttons, no decorative animation. API client: GETs retry with jittered backoff, **mutations never auto-retry** (a retried `POST /orders` is a second order), single-flight token refresh, refresh token in Keychain/Keystore — never AsyncStorage. Network failure is status 0 and renders as "no internet", never as a server error. |
| 14.2 | Splash / Get Started | Done | The delivery promise is read from `DELIVERY_PROMISE_TEXT` config, **not hardcoded** — the mockups contradicted themselves (10 vs 30 minutes) and a promise compiled into the binary cannot be corrected without a store release. |
| 14.3 | Mobile number entry | Done | +91 prefix, local validation only to gate the button — the server normalises and decides. |
| 14.4 | OTP verification | Done | Six boxes with paste/SMS-autofill handling, resend countdown, "never share your OTP" notice (the most effective defence against the phone-call scam targeting exactly these users). Dev OTP auto-fills from the console provider. |
| 14.5 | Location + serviceability | Done | **A denied permission is not a dead end** — manual entry offered, since refusal is common on shared and second-hand phones. **Out-of-area still allows browsing**, turning a dead end into demand data. Balanced (not Highest) GPS accuracy: precision serviceability doesn't need, at battery cost it doesn't justify. |
| 14.6 | Home screen | Done | Fills entirely from **one** `GET /home` call — on rural 3G a single round trip beats six. Location bar, category row, five rails, add-to-cart inline. Shows store-closed and out-of-area notices without blocking browsing. |
| 14.7 | Categories + search | Done | Subcategory sidebar + product grid + sticky "N items · Checkout" bar. Search does **no client-side filtering** — the server handles local names (`cheeni`) and typos (`colgat`) better than the app could. |
| 14.8 | Product detail + out-of-stock | Done | Variants are **selectable**, not collapsed — the cart treats each as its own line, so the customer must see which size they are buying. Out-of-stock state with "Notify me" and "You may also like". Vertical-specific attributes render from `products.attributes`, the same slot that carries prescription flags at V4. |
| 14.9 | Cart | Done | The bill is rendered **exactly as the server returned it** — there is no arithmetic in the file to disagree with. `changes[]` shown prominently as notice strips: a customer discovering a changed total at the payment screen is how trust is lost. |
| 14.10 | Checkout (Address → Payment → Review → Place Order) | Done — **not yet device-tested** | The bill comes from `POST /checkout/quote`, which runs the **same pricing engine** as order creation, so the app computes nothing. **One idempotency key per checkout attempt**, reused across every retry of that attempt; regenerated only when the basket changes. Button disables on first press. `expectedTotalPaise` sent purely as a safety check — on `PRICE_CHANGED` the quote refreshes and the customer re-confirms rather than being charged more. COD renders **disabled with the server's reason**, never hidden. |
| 14.11 | Order tracking | Done | Timeline comes from the server **already mapped** to the mockup's 5 customer steps — the app never switches on a raw status. Socket updates **plus** a 30 s poll. Terminal states show an exception banner instead of a progress bar ("step 2 of 5" on a cancelled order is nonsense). Delivery OTP shown prominently for COD. |
| 14.12 | My Orders | Done | Badges use the coarse bucket (Ongoing / Delivered / Cancelled), not internal statuses — a customer needn't know `READY_FOR_PICKUP` from `PREPARING`. Pull to refresh. |
| 14.13 | My Addresses + Add Address form | Done | List screen plus a separate **Add New Address** form matching the mockup: Full Name, Phone, **Pincode + Check**, Address Line 1/2, City, State dropdown, Country (fixed to India), **Address Type chips**, **Default toggle**. Non-serviceable addresses are shown and flagged rather than hidden. Address limit read from config, not hardcoded. **Pincode Check caveat:** serviceability is decided by distance from the store, and an Indian PIN code spans 10+ km — so Check validates the format and runs the *real* serviceability call against detected coordinates, saying so plainly when no location is available rather than inventing an answer. |
| 14.14b | About AdiOne | Done | Logo, tagline, 4 feature rows, app info, "Made with care in India". Delivery promise, support phone and email all read from **public configuration**, so the copy can be corrected without a Play Store release. Phone and email are tappable. |
| 14.14 | Account | Done (first pass) | Profile, menu, logout. Prompts to verify an unproven mobile number, since the rider phones it. |
| 14.15–14.16 | Refer & Earn, error/edge screens | Not Started | |

**Tab bar (decision O2):** Home · Categories · Search · Cart · Account, with a
live cart badge. Cart takes the fifth slot because it needs one-tap access
constantly; Orders is reached from Account and from the live-order banner.
| 14.6 | Home screen | Not Started | |
| 14.7 | Category listing screen (sidebar + grid + sticky cart bar) | Not Started | |
| 14.8 | Product detail screen + out-of-stock variant | Not Started | |
| 14.9 | Cart screen | Not Started | |
| 14.10 | Checkout flow (Address → Payment → Review → Place Order) | Not Started | |
| 14.11 | Order confirmation/details + Order Tracking (live) | Not Started | |
| 14.12 | My Orders list screen | Not Started | |
| 14.13 | My Addresses screen | Not Started | |
| 14.14 | Profile/Account + Personal Information screens | Not Started | |
| 14.15 | Refer & Earn screen | Not Started | |
| 14.16 | Error/edge-case screens (closed, out-of-area, offline, failures) | Not Started | |

## Phase 15 — Integration & Cross-cutting

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 15.1 | Mobile connected to real APIs | Done | **No mock data was ever written** — every screen has read from the live API since it was created, per the brief's rule against mocks once the backend exists. Phase 15 completed the wiring: per-tab stacks so back behaviour matches the customer's mental model (backing out of a product opened in Search returns to Search), `replace` after order placement so back cannot re-enter a checkout whose cart is gone, and the socket now opens on login/refresh and closes on logout. |
| 15.2 | Admin panel connected to real APIs | Done | Verified end-to-end in Phase 13 — login, dashboard, orders, agents, and a config write round-tripping to `/config/public`. |
| 15.3 | Network / retry / duplicate-submit handling | Done | Built into the API client from the start: GETs retry twice with jittered backoff, **mutations never auto-retry**, single-flight token refresh, 15 s timeout (30 s for orders), network failure surfaces as "no internet" rather than a server error, and the checkout button disables on first press behind an idempotency key. |
| 15.4 | API hardening | Done | Rate limits (OTP, login, signup, orders, global), `helmet`, CORS allow-list, Zod validation on every input, PII-redacting structured logs with request-id correlation, and fail-fast env validation that blocks dev stubs in production. Secrets live only in git-ignored `.env` files. |

## Phase 16 — Testing

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 16.1 | Backend unit + integration suite | Done | 122 tests across auth/OTP, serviceability, store hours, cart revalidation, checkout re-validation, order state transitions, payment verification, COD precedence, **inventory concurrency** and **idempotency** — all against real PostgreSQL, because row locks and CHECK constraints only exist there. |
| 16.2 | Mobile critical-flow tests | **Deferred — deliberately** | Flow tests written before the app has ever executed would mostly encode my own assumptions. Worth writing immediately after the first successful device run, when they can encode what actually broke. |
| 16.3 | End-to-end lifecycle | Done | 4 journeys, 126 tests total. **Full online journey**: register → browse → cart → address → quote → order → pay → accept → prepare → pack → assign → dispatch → deliver, asserting stock moves reserved→sold, the 8-row status history, and ≥5 customer notifications. **COD**: delivery OTP rejected when wrong, cash recorded against the rider. **Rejections**: out-of-area refused with no order created; a rejected paid order **auto-refunds and restocks** without anyone pressing a button. |

## Phase 17 — Production Readiness

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 17.1 | Dockerize + prod compose | Done | Multi-stage builds — runtime carries no compiler, no dev deps, no source. Non-root user, `dumb-init` as PID 1 so SIGTERM reaches Node and graceful shutdown actually runs. **Only `web` publishes a port**; Postgres, Redis and the API are internal-only. Panel is served by Nginx (~25 MB) rather than a Node process serving static files. Nightly `pg_dump` with 14-day retention. |
| 17.2 | Env separation + migration workflow | Done | Three environments with distinct config files and databases. Production **refuses to boot** on any dev stub; tests refuse to run against a non-`_test` database. Migrations run before the new code starts and a failure stops the container — plus the expand/contract rule, so each migration is safe against the previous release still running. |
| 17.3 | Deployment documentation | Done | [docs/06-deployment.md](docs/06-deployment.md): topology, env separation, deploy + rollback, TLS/webhook setup, pre-launch checklist (**DLT registration flagged as the first thing to start**), and a **backup restore drill** — a backup never restored is not a backup. |

---

## Decision Log

Decisions made during execution that later tasks depend on.

Full record with rationale: [docs/02-decisions.md](docs/02-decisions.md).

| # | Decision | Where |
|---|----------|-------|
| A1 | **Three independent project folders**, not a monorepo. Shared contract mirrored by `sync:shared`. | user, 0.2 |
| D1 | Money is integer **paise** stored as `Int` (not `BigInt`, not `Decimal`, never float). | 1.2 |
| D2 | Categories are a **single self-referencing tree** (`parent_id` + materialised `path`), not a separate `subcategories` table. | 1.2 |
| D3 | Store-scoped price **and** stock live together in **`store_variants`**, replacing a standalone `Inventory` table. | 1.2 |
| D4 | COD is a 3-state enum (`ALLOW`/`DENY`/`INHERIT`) resolved outward, **most restrictive wins**. | 0.1 |
| D5 | 12 internal order states mapped to the **5-step customer timeline** in one place. | 0.1 |
| D6 | Serviceability uses straight-line Haversine; ETA and delivery fee apply `ROAD_DISTANCE_FACTOR` (1.3). | 0.1 |
| D9 | `CacheStore` port with `memory` (dev) and `redis` (prod) drivers — dev machine has no Redis or Docker. Production boot is **blocked** on the memory driver. | 0.3 |
| D10 | Partial indexes, `CHECK` constraints and search objects live in a hand-written `hardening` migration; the `@@index` entries they replace were removed from `schema.prisma`. | 1.2 |
| D11a | Trigram search must use **`<%` / `word_similarity()`**, not `%` — measured, not assumed. | 1.2 |
| D16 | **Test mode loads only `.env.test`**, never the development `.env`, and the env validator hard-fails if `NODE_ENV=test` with a DATABASE_URL not ending in `_test`. `truncateAll()` additionally asks `SELECT current_database()` before issuing TRUNCATE. Three independent layers, added after a real incident (below). | 2.4 |
| D17 | Refresh tokens are **rotated with family-wide reuse detection** rather than long-lived. Replaying a spent token ends every session in that family. | 2.3 |
| D18 | **A mobile number supplied at password signup is not a verified number.** `users.mobile_verified_at` records proof; OTP signup/login sets it, password signup does not. The rider phones that number and COD settlement depends on reaching a real person, so this is a delivery/fraud control, not a cosmetic flag. | 2.6 |
| D19 | **Login discloses nothing; signup discloses precisely.** Login returns one identical message for every failure mode (plus a dummy bcrypt compare so timing matches) because it must not enumerate accounts. Signup names the clashing field, because the user cannot proceed otherwise and the failure already reveals it. | 2.5, 2.6 |
| D20 | **UPI package visibility is declared through a config plugin**, `mobile/plugins/withUpiQueries.js`, not by editing `android/`. Android 11+ hides packages the app has not declared a `<queries>` intent for, so `Linking.canOpenURL('upi://…')` returns false with GPay/PhonePe installed and every customer would see "No UPI app found". Editing the generated manifest works until the next `expo prebuild --clean` silently drops it. | APK build |
| O1–O12 | Zustand+TanStack Query · tabs Home/Categories/Search/Cart/Account · MSG91 · admin email+password · Razorpay · referral & ratings & wishlist off · "in 30 minutes" copy · Expo · Prisma · Sikar placeholder coords · not GST-registered. | 1.1 |

## Incident log

**2026-08-14 — test suite truncated the development database.**
The first test run pointed at `adione` instead of `adione_test`: `env.ts`
resolved `.env.test` from a `__dirname`-relative path that did not hold under
Vitest's transform, so the development `.env` won and `truncateAll()` wiped the
seeded catalogue. Data was re-seeded (it was all reproducible seed data; no
real data existed yet). Fixed with three independent layers — test mode now
loads *only* `.env.test`, the env validator rejects a non-`_test` database
under `NODE_ENV=test`, and `truncateAll()` verifies the live connection with
`SELECT current_database()` before truncating. The validator guard was then
proven to fail closed. See decision D16.

## Notes carried forward

- **Store coordinates, hours, fees and support numbers are placeholders**
  (Sikar 27.6094, 75.1399, taken from the mockups). They are seed data,
  editable from the admin Configuration screen — replacing them is a form
  submission, not a code change. Coordinates specifically are now set from
  **Configuration → Store location** (`PATCH /admin/store`), including a
  "Use my current location" button backed by the browser Geolocation API.
  Leaving them on the placeholder makes every real customer see
  "we don't deliver to your area yet", which looks like a bug and is not one.
- **DLT/SMS registration and payment-gateway KYC block launch, not
  development** — both take days to weeks. The `console` OTP and `mock`
  payment providers cover all development and testing until then.
- Local dev DB: `postgresql://postgres:admin@localhost:5432/adione`.
  Redis and Docker are not installed on this machine; the backend runs without
  them.
- **The APK is signed with Expo's debug keystore** (`android/app/build.gradle`
  points `release` at `signingConfigs.debug`). Fine for sideloading and
  internal testing; a real upload key must be generated before Play Store
  submission, and it cannot be changed afterwards without losing the listing.
- **`EXPO_PUBLIC_*` and `VITE_*` are inlined at build time.** The backend URL
  is baked into the APK and the web bundle, so changing it means rebuilding.
  The free ngrok URL rotates whenever the tunnel restarts, which bricks any
  APK already installed — a reserved domain avoids this.
- Gradle's wrapper download needed `networkTimeout=180000` in
  `android/gradle/wrapper/gradle-wrapper.properties`; the 10s default was too
  short for this connection to finish the TCP connect to services.gradle.org.
