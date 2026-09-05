# AdiOne — Backend Technical Documentation

**Document:** 03 — Backend technical
**Scope:** `backend/` — the API, the database, the background jobs, the realtime channel
**Companion documents:** [01 — PRD & Architecture](01-PRD-and-Architecture.md) · [02 — Decisions](02-decisions.md) · [04 — API reference](04-api-reference.md) · [06 — Deployment](06-deployment.md)

---

## Table of contents

1. [Stack and why](#1-stack-and-why)
2. [Process lifecycle](#2-process-lifecycle)
3. [Request pipeline](#3-request-pipeline)
4. [Module anatomy](#4-module-anatomy)
5. [The shared contract](#5-the-shared-contract)
6. [Configuration and environment](#6-configuration-and-environment)
7. [Ports and adapters](#7-ports-and-adapters)
8. [Data model](#8-data-model)
9. [Authentication and authorisation](#9-authentication-and-authorisation)
10. [Pricing engine](#10-pricing-engine)
11. [Serviceability and ETA](#11-serviceability-and-eta)
12. [Order lifecycle](#12-order-lifecycle)
13. [Inventory and the stock ledger](#13-inventory-and-the-stock-ledger)
14. [Payments](#14-payments)
15. [Idempotency](#15-idempotency)
16. [Rate limiting](#16-rate-limiting)
17. [Realtime](#17-realtime)
18. [Background jobs](#18-background-jobs)
19. [Errors and logging](#19-errors-and-logging)
20. [Testing](#20-testing)
21. [Performance notes](#21-performance-notes)
22. [Extension points](#22-extension-points)

---

## 1. Stack and why

| Concern | Choice | Reasoning |
|---|---|---|
| Runtime | Node.js ≥ 20 | One language across API, panel and app; the same shared contract file runs in all three |
| Framework | Express 5 | Rejected promises are forwarded to the error handler natively; small enough that the request pipeline is readable end to end |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | The wire contract is enforced at compile time in all three projects |
| Database | PostgreSQL ≥ 14 | Transactions with row-level locking are load-bearing for order placement; full-text + trigram search removes a search service from V1 |
| ORM | Prisma 5 | Typed queries and a real migration history; raw SQL is used where the query shape matters |
| Validation | Zod | The same schema validates and **normalises** (a mobile number is canonicalised before it is ever seen downstream) |
| Cache | Redis, or in-process `node-cache` | Redis is optional in development; production requires it unless single-instance is explicitly accepted |
| Realtime | Socket.IO | Automatic reconnection and long-polling fallback matter far more on rural 3G than raw efficiency |
| Logging | Pino | Structured JSON, one request id threaded through every line |
| Tests | Vitest + supertest | |

---

## 2. Process lifecycle

`src/server.ts` owns boot and shutdown.

**Boot**

1. `config/env.ts` loads and validates the environment. Invalid → print exactly
   which keys are wrong and `process.exit(1)`.
2. `createApp()` assembles Express.
3. `checkDatabaseConnection()` — booting "successfully" against an unreachable
   database only moves the failure to the first customer request.
4. `app.listen(PORT)`.
5. `initRealtime(server)` — Socket.IO shares the HTTP server, so there is one
   port and one TLS termination point rather than a second listener to expose
   and secure.
6. `startJobs()`.

**Shutdown** on `SIGTERM` / `SIGINT` / `unhandledRejection` / `uncaughtException`:

1. Stop jobs and realtime — stop taking new work before closing connections.
2. `server.close()` — finish in-flight requests.
3. Disconnect the database and cache.
4. Exit 0.

A 15-second hard deadline forces a non-zero exit if something hangs. This
matters because a `SIGTERM` during a deploy must not kill a request that is
halfway through creating an order with inventory rows locked.

---

## 3. Request pipeline

`src/app.ts`. **The order is deliberate and load-bearing.**

| # | Middleware | Why here |
|---|---|---|
| 1 | `trust proxy` | So `req.ip` is the real client, not the load balancer — every per-IP rate limit depends on it |
| 2 | `requestLogger` | Assigns the request id **before** anything can fail, so even a 500 is traceable |
| 3 | `helmet` | Security headers on every response, including errors |
| 4 | `cors` | Reject disallowed origins before doing any work |
| 5 | `express.raw` on `/payments/webhook` | **Must precede the JSON parser.** Signatures are computed over the exact bytes; a re-serialised body never verifies |
| 6 | `express.json` / `urlencoded` / `cookieParser` | 1 MB limit |
| 7 | `compression` | |
| 8 | `/static` (local storage only) | Product images in development |
| 9 | `/health`, `/api/v1` | |
| 10 | `notFoundHandler` | |
| 11 | `errorHandler` | Last, always |

Within `/api/v1`, `publicApiLimit` applies to everything; route-specific
limiters stack on top rather than replacing it.

Per-route the chain is:

```
authenticate → requirePermission → rateLimit → validate → idempotency → handler
```

`validate` before the per-mobile limiters, so they count the normalised number.
`idempotency` last, so a rejected request never consumes the key.

### Response envelope

`src/common/response.ts` is the **only** place that constructs the envelope.
Controllers call `ok()`, `created()`, `noContent()`, `okCursorPage()` or
`okOffsetPage()` and never build a response object by hand, so the shape cannot
drift between endpoints.

`buildCursorPage()` fetches `limit + 1` rows: the extra row tells us whether
another page exists without a second `COUNT`.

---

## 4. Module anatomy

```
src/modules/<domain>/
├── <domain>.routes.ts       HTTP surface: middleware chain, Zod schemas
├── <domain>.controller.ts   Shape in, shape out. No decisions.
├── <domain>.service.ts      All business logic. Ownership checks live here.
├── <domain>.repository.ts   Prisma / SQL access
└── <domain>.validation.ts   Zod schemas (where non-trivial)
```

Smaller modules collapse the controller into the routes file (`cart`,
`addresses`, `payments`, `notifications`); the boundary that matters is
routes ↔ service.

| Module | Owns |
|---|---|
| `auth` | OTP, password login/signup, tokens, profile, deletion |
| `configuration` | The business-rule registry, cached per store |
| `stores` | Store details, opening hours, serviceability |
| `catalog` | Categories, products, variants, search, home feed |
| `cart` | Server-held cart and revalidation |
| `pricing` | The bill. Nothing else computes money |
| `addresses` | Saved addresses with server-computed serviceability |
| `orders` | Placement, listing, cancellation, `order-state.service` |
| `payments` | Provider orchestration, verification, webhooks, refunds |
| `inventory` | Stock, ledger, low stock |
| `delivery` | Agents, assignment, cash summary |
| `notifications` | In-app rows and push dispatch |
| `admin` | Dashboard, order board, admin composition root |
| `legal` | Privacy and terms, as JSON and as HTML |
| `health` | Liveness and readiness |

**Ownership is never a route guard.** `requirePermission(ORDER_READ_OWN)`
grants the *ability* to read one's own orders; whether *this* order belongs to
*this* customer is checked in the service, every time.

---

## 5. The shared contract

`src/shared/` is canonical and is mirrored into both clients by
`npm run sync:shared`.

| File | Contents |
|---|---|
| `enums.ts` | Every domain enum, as `const` objects + derived union types |
| `errors.ts` | `ErrorCode`, HTTP status map, default user-facing copy |
| `api.ts` | The response envelope, pagination types, header names |
| `dto.ts` | Every shape that crosses the wire |
| `order-state-machine.ts` | Legal transitions, actor table, customer timeline mapping, admin tabs |
| `permissions.ts` | Permission list and the role → permission map |
| `config-keys.ts` | Config registry, defaults, descriptions, public allow-list |
| `money.ts` `distance.ts` `cod.ts` `datetime.ts` `phone.ts` `text.ts` | Pure helpers |
| `theme.ts` | Design tokens |

Enums are `const` objects rather than TypeScript `enum`s so the runtime value is
a plain string (interoperating directly with the Postgres enums Prisma
generates), the type is safe under `isolatedModules`, and clients can switch
exhaustively.

Everything here is dependency-free and platform-neutral: the same file runs
under Node, in a browser and under Hermes.

**The trade-off, stated plainly:** three independent folders mean the contract
is *copied*, not imported from a linked package, so a stale copy is possible if
the sync is skipped. `npm run sync:shared -- --check` exists for exactly that,
and belongs in CI.

---

## 6. Configuration and environment

Two distinct layers, and conflating them is the mistake this design exists to
prevent:

| Layer | Lives in | Changes | Examples |
|---|---|---|---|
| **Environment** | `.env` / process env | Requires a restart; set by an operator | `DATABASE_URL`, `JWT_SECRET`, provider selection |
| **Business configuration** | `configurations` table | At runtime, by the store owner in the panel | Radius, fees, hours, COD policy, ETA parameters |

`config/env.ts` validates the environment with Zod and **exits** on failure.
Beyond field validation it enforces cross-field rules (`REDIS_URL` required
when `REDIS=true`, `UPI_VPA` required for `upi_intent`, S3 credentials required
for `s3`) and two categories of guard:

- **Production guards** reject `OTP_PROVIDER=console`, `PAYMENT_PROVIDER=mock`,
  `STORAGE_PROVIDER=local`, `REDIS=false` (without an explicit opt-in) and
  example secrets.
- **The test guard** loads *only* `.env.test` when `NODE_ENV=test` and refuses
  a `DATABASE_URL` whose database name does not end in `_test`. The suite
  truncates every table; layering `.env` and overriding it was too fragile for
  something that destructive.

Business configuration is read through `configuration.service`, cached per
store under `config:{storeId}`, and invalidated on write. `CONFIG_DEFAULTS` is
the seed source and a last-resort runtime fallback; the database is the source
of truth once seeded.

---

## 7. Ports and adapters

Every external dependency sits behind an interface in `src/infra/`. **No
provider SDK is imported anywhere else in the codebase.**

| Port | Adapters | Selected by |
|---|---|---|
| `CacheStore` | `redis.store`, `memory.store` | `REDIS` |
| `OtpProvider` | `msg91.provider`, `console.provider` | `OTP_PROVIDER` |
| `PaymentProvider` | `upi-intent.provider`, Razorpay, mock | `PAYMENT_PROVIDER` |
| `StorageProvider` | S3-compatible, local disk | `STORAGE_PROVIDER` |
| `SearchProvider` | Postgres FTS + trigram | `SEARCH_PROVIDER` |
| `NotificationProvider` | FCM, console | `NOTIFICATION_PROVIDER` |

This is what makes swapping MSG91 for another SMS vendor, or Postgres search
for Meilisearch, a new file in `infra/` rather than a change to any service.

`CacheStore` also carries the cache key registry, so key formats are declared
in one place:

```
otp:code:{mobile}        otp:attempts:{mobile}     otp:cooldown:{mobile}
rl:{scope}:{identifier}  config:{storeId}          store:open:{storeId}
```

---

## 8. Data model

`prisma/schema.prisma` — 31 models, 22 enums, five migrations. Highlights
rather than a field-by-field listing (the schema is the reference).

### Conventions

- **UUID primary keys**, `snake_case` table and column names, `@@map` to keep
  TypeScript idiomatic.
- **Money is `Int` paise.** Field names end in `Paise`.
- **Timestamps are `timestamptz(3)`.**
- Indexes are declared to match the query's *filter → sort* shape exactly, in
  that column order.

### Core entities

| Group | Models |
|---|---|
| Identity | `User`, `RefreshToken`, `Address` |
| Store | `Store`, `StoreHours`, `StoreClosure` |
| Catalogue | `Category`, `Brand`, `Product`, `ProductVariant`, `ProductImage` |
| Store-scoped commerce | `StoreVariant`, `StockLedger` |
| Cart | `Cart`, `CartItem` |
| Promotions | `Coupon`, `CouponRedemption` |
| Orders | `Order`, `OrderItem`, `OrderStatusHistory` |
| Money | `Payment`, `PaymentEvent`, `Refund` |
| Delivery | `DeliveryAgent`, `DeliveryAssignment` |
| Messaging | `Notification`, `DeviceToken`, `BackInStockSubscription` |
| Platform | `Configuration`, `IdempotencyKey`, `AuditLog` |

### The catalogue / store split

`ProductVariant` holds what a product **is** (SKU, unit, size). `StoreVariant`
holds what it **costs and how many are in stock** *at a given store*. V1 has one
store, so the split looks redundant — it is the entire reason multi-store is an
addition rather than a rewrite. Price and stock are read from `StoreVariant`
everywhere; nothing reads a price off `ProductVariant`.

### Orders are snapshots

`Order` copies the delivery address inline (`deliveryFullName`,
`deliveryAddressLine`, `deliveryLatitude`, …) and `OrderItem` copies the product
name, variant name, brand, image, SKU and unit display. Editing or deleting a
saved address later cannot rewrite where an order was actually sent, and
renaming a product does not rewrite history.

`orderNumber` is `"AD" + YYMMDD + 6 unambiguous characters` — random rather
than sequential, so daily volume is not inferable from two order numbers, and
short enough to read aloud to support.

Key indexes on `Order`:

- `@@unique([userId, idempotencyKey])` — the database is the arbiter of
  "already placed", not an in-memory mutex.
- `@@index([storeId, status, createdAt])` — *the* admin panel query.
- `@@index([userId, createdAt])` — "My Orders".
- A **partial** index on `reservationExpiresAt WHERE status = 'PENDING_PAYMENT'`
  so the reservation-release job stays O(pending) forever rather than scanning
  an ever-growing table.

### Seeds

`prisma/seed/reference.ts` writes configuration defaults, the store, opening
hours and the admin user. `prisma/seed/demo.ts` adds a demo catalogue.
`npm run db:seed` runs both; it is idempotent.

---

## 9. Authentication and authorisation

### Tokens

| Token | Form | TTL | Storage |
|---|---|---|---|
| Access | JWT HS256, claims `sub` + `role` | `JWT_ACCESS_TTL` (15 min) | Memory only, in both clients |
| Refresh | Opaque random, hashed at rest | `JWT_REFRESH_TTL_DAYS` (30) | Keychain/Keystore (mobile), `localStorage` (panel) |

Refresh tokens **rotate on every use**: the presented token is revoked and a new
one issued. A short access-token TTL bounds the damage from a leaked token; a
long refresh TTL means the shopkeeper is not re-authenticating at the counter
every 15 minutes.

### OTP

- Generated with a CSPRNG, `OTP_LENGTH` digits.
- Stored as an **HMAC with `OTP_PEPPER`**, never in plaintext. Rotating the
  pepper invalidates all in-flight OTPs, which is safe.
- `OTP_TTL_SECONDS` expiry, `OTP_MAX_ATTEMPTS` before invalidation,
  `OTP_RESEND_COOLDOWN_SECONDS` between sends.
- Three stacked rate limiters (see [§16](#16-rate-limiting)).

### Permissions

`shared/permissions.ts` maps roles to permissions. Routes declare
`requirePermission(Permission.X)`. Adding `STORE_MANAGER` or `DELIVERY_AGENT`
later is a map entry, not a route rewrite.

`requireAdmin` gates the whole `/admin` subtree on a staff role, and each route
underneath still declares its specific permission — defence in depth, and it
keeps the individual permission visible at the route.

`POST /auth/admin/login` additionally requires a staff role, so a customer with
correct credentials cannot obtain a panel session.

---

## 10. Pricing engine

`modules/pricing/pricing.service.ts` is the **only** place a bill is computed.
It is called by cart reads, `POST /checkout/quote` and `POST /orders`, so the
number on the Review screen and the number charged come from the same code
path.

```
itemsSubtotalPaise      Σ (mrpPaise × qty)
− itemDiscountPaise     Σ ((mrp − price) × qty)
− couponDiscountPaise   PERCENT (capped by maxDiscountPaise) | FLAT | FREE_DELIVERY
+ deliveryFeePaise      first DELIVERY_FEE_SLABS band covering the road distance,
                        waived above FREE_DELIVERY_THRESHOLD_PAISE
+ platformFeePaise      PLATFORM_FEE_PAISE (0 hides the line)
= totalPaise

taxPaise                extracted from within the item prices for the receipt.
                        NEVER added on top.
```

Rules that hold everywhere:

- **Integer paise only.** Rounding is explicit and happens once, at the point a
  percentage is applied.
- **`expectedTotalPaise` from the client is a comparison, never an input.** A
  mismatch raises `PRICE_CHANGED` and the customer re-confirms.
- A cart read **revalidates** every line against live price, stock and limits
  and reports the corrections in `changes[]` rather than silently mutating the
  customer's cart.

---

## 11. Serviceability and ETA

`modules/stores/store.service.ts` + `shared/distance.ts`.

**Serviceability** — Haversine straight-line distance from the store, compared
against `MAX_SERVICE_RADIUS_KM`. Straight-line, not road distance: the boundary
must be stable and explicable ("we deliver up to 10 km"), and a routing API
call on every location change is both a cost and a dependency.

`ROAD_DISTANCE_FACTOR` (default 1.3) converts straight-line to an estimated road
distance for **the ETA and the delivery fee only**, never for the boundary.

**ETA**

```
prep      = BASE_PREPARATION_MINUTES + (itemCount × PER_ITEM_PICK_SECONDS / 60)
travel    = roadKm / AVG_DELIVERY_SPEED_KMPH × 60
batching  = floor(activeOrders / ORDERS_PER_RIDER_BATCH) × BATCH_DELAY_MINUTES
eta       = prep + travel + batching + ETA_BUFFER_MINUTES
```

Returned as a range (`etaMinMinutes` … `etaMaxMinutes`) because a single number
is a promise the store cannot keep. `promisedAt` is stored on the order so the
promise is auditable afterwards.

`DELIVERY_PROMISE_TEXT` ("in 30 minutes") is marketing copy for banners only.
The per-order ETA is always computed.

**Store open** is evaluated in `STORE_TIMEZONE` against `StoreHours` and
`StoreClosure`, cached under `store:open:{storeId}`.

`Store.isActive` sits in front of all of it: it is the owner's trading switch
(`PATCH /admin/store/status`), and while it is off the store reports closed
whatever the schedule says. It is deliberately **not** a filter on store
resolution — a switched-off store must still resolve so the catalogue keeps
loading and the panel can switch it back on. Ordering is refused by
`assertStoreAcceptingOrders`, which checks the switch *before* consulting
`ALLOW_ORDERS_WHEN_CLOSED`, so that config cannot override it.

---

## 12. Order lifecycle

### Placement — `orders/order.service.ts`

Inside **one transaction**:

1. `SELECT … FOR UPDATE` on every `StoreVariant` in the cart, **in a
   deterministic order** so two concurrent orders cannot deadlock.
2. Revalidate availability, per-item limits and prices.
3. Recompute the bill from scratch. Compare against `expectedTotalPaise`.
4. Resolve COD eligibility.
5. Create the order, items, the address snapshot, and the initial status
   history row.
6. Move stock: reserve (`ONLINE`) or commit (`COD`), writing ledger rows.
7. Clear the cart.

**No third-party call happens inside the transaction.** Creating a payment
order with the provider happens after commit, in a separate request.

`ONLINE` orders start at `PENDING_PAYMENT` with
`reservationExpiresAt = now + PAYMENT_HOLD_MINUTES`. `COD` orders go straight to
`ORDER_PLACED`.

### Transitions — `orders/order-state.service.ts`

`transitionOrder()` is the **only** code permitted to write `orders.status`. It:

1. Loads and locks the order.
2. Validates against `ALLOWED_TRANSITIONS` → `INVALID_STATUS_TRANSITION`.
3. Validates the actor against `TRANSITION_ACTORS`. **Absence of an entry means
   system-only** — it fails closed, never open.
4. Applies side effects: stock release/commit/restock, the lifecycle timestamp,
   delivery-OTP verification, cash collection.
5. Writes an `OrderStatusHistory` row with actor, reason and timestamp.
6. Enqueues a notification and emits the realtime event.

Because status, stock and history all move inside one call, they cannot
disagree.

The full transition table and the customer-facing five-step timeline mapping
are in [04 — API reference §14](04-api-reference.md#14-checkout--orders).

---

## 13. Inventory and the stock ledger

Every change to stock writes **one `StockLedger` row** with a reason. Current
stock and the sum of its movements must always agree; when they do not, the
ledger says which write was wrong.

| Reason | Written when |
|---|---|
| `ORDER_RESERVE` | An online order holds stock pending payment |
| `ORDER_RELEASE` | The hold expires or payment fails |
| `ORDER_COMMIT` | Payment confirmed, or a COD order placed |
| `ORDER_CANCEL_RESTOCK` | A committed order is cancelled |
| `PURCHASE`, `MANUAL_ADJUST`, `DAMAGE`, `EXPIRY`, `RETURN` | Store actions |

`availableQty` is `stockQty` minus active reservations. Reservations are what
make it safe to show "12 left" while three unpaid checkouts are in flight.

`lowStockThreshold` per variant falls back to `LOW_STOCK_THRESHOLD`.
`BackInStockSubscription` rows are drained by a background job when stock
returns.

---

## 14. Payments

### Provider modes

| Mode | Confirmation | Notes |
|---|---|---|
| `mock` | Immediate, deterministic | Development and tests only; blocked in production |
| `upi_intent` | **Manual, by the store** | A `upi://pay?…` deep link to the shop's VPA. There is no callback, because there is no gateway |
| `razorpay` | Client callback + webhook + reconciliation | |

`upi_intent` is the honest mode for a small shop with no gateway account: money
goes straight to the shopkeeper's VPA at zero MDR, and the trade-off is that
**nothing tells the server the money arrived**. The system is built around that
rather than pretending otherwise:

- `CreatePaymentResponse.requiresManualConfirmation = true`, so the app shows
  "I have paid" instead of a spinner waiting for a callback that never comes.
- `POST /payments/claim` records the customer's claim plus an optional 12-digit
  UTR. **It confirms nothing.**
- The order appears in the admin `PAYMENT_PENDING` tab with the UTR, which is
  what the shopkeeper matches against their own UPI app.
- `POST /admin/orders/{id}/confirm-payment` is the only thing that moves the
  money state — admin-only, so nothing a customer sends can reach it.

### Three settlement paths

Each can fail independently, so all three exist:

1. **Client callback** — `POST /payments/verify`, signature verified
   server-side, amount checked against the order.
2. **Webhook** — `POST /payments/webhook`, HMAC over the **raw** bytes.
   `express.raw()` is mounted above the JSON parser for this path; parsing then
   re-stringifying changes key order and whitespace and the signature would
   never match.
3. **Reconciliation job** — polls the provider for orders still unpaid,
   covering the case where the customer paid but neither the callback nor the
   webhook arrived.

All three converge on the same idempotent confirmation routine, so a payment
confirmed twice is confirmed once.

---

## 15. Idempotency

`middleware/idempotency.ts`, backed by `IdempotencyKey` with
`UNIQUE (user_id, key)`. On a 3G connection a request routinely succeeds
server-side while the response never arrives; without this the customer taps
again and gets two orders and two charges — the single most damaging bug this
system could ship.

The request body is hashed together with the endpoint name, so the same key
used for a genuinely different request is refused rather than replayed.

| Case | Result |
|---|---|
| New key | Processed; response stored for 24 h |
| Repeat, `COMPLETED` | Stored response replayed verbatim, no side effects |
| Repeat, `IN_PROGRESS` | `409 ORDER_IN_PROGRESS` |
| Same key, different body | `409 IDEMPOTENCY_KEY_REUSED` |
| Missing / malformed | `400 IDEMPOTENCY_KEY_REQUIRED` |

An in-memory mutex would not survive a restart and would not work across
processes, which is why the database is the arbiter.

---

## 16. Rate limiting

Fixed-window counters in the `CacheStore`. **The TTL is set only when the
counter is created**, so a caller cannot extend their own window by making more
requests — the classic way a naive implementation becomes a no-op under load.

Limiters compose. `POST /auth/send-otp` carries three: per mobile per hour, per
mobile per day, per IP per hour. Per-mobile alone lets one attacker SMS-bomb
many numbers; per-IP alone is defeated by a mobile network's shared NAT.
Together they cover both.

`X-RateLimit-Limit` and `X-RateLimit-Remaining` are always set; a rejection
carries `retryAfterSeconds` derived from the counter's remaining TTL.

The full table is in [04 — API reference §4](04-api-reference.md#4-rate-limits).

> With `REDIS=false`, counters are per-process and lost on restart. That is why
> production requires Redis unless `ALLOW_MEMORY_CACHE_IN_PRODUCTION=true` is
> set deliberately for a single-instance deployment.

---

## 17. Realtime

`src/realtime/socket.ts`. Socket.IO shares the HTTP server.

- The handshake is authenticated with the same access token as HTTP; an expired
  token is rejected, so a socket cannot leak another customer's order updates.
- Every client joins `user:{userId}` automatically.
- `store:{storeId}` is joined only via `store:subscribe`, and only by staff
  roles. A non-staff attempt is logged and ignored.
- Transports are `['polling', 'websocket']` in that order: some Indian mobile
  networks and corporate proxies block websocket upgrades outright.

Emitters: `emitOrderStatus` (customer), `emitNewOrder` and
`emitStoreOrderStatus` (store).

**Realtime is an optimisation, never the only path.** Both clients poll as well.
A dropped socket must never cause the store to miss an order.

---

## 18. Background jobs

`src/jobs/index.ts` — an in-process scheduler, not a queue. At this volume a
queue would be infrastructure to run, monitor and debug for no benefit. Each
job is small, idempotent and safe to run alongside live traffic, which is what
makes extracting them into a worker later a deployment change rather than a
rewrite.

| Job | Interval | Purpose |
|---|---|---|
| `release-reservations` | 1 min | Release stock held by online orders whose payment never completed. Without it, one abandoned checkout removes an item from sale forever |
| `reconcile-payments` | 5 min | The third settlement path |
| `retry-notifications` | 2 min | Redeliver queued notifications |
| `back-in-stock` | 5 min | Notify `BackInStockSubscription` holders |
| `cleanup` | 1 h | Expire idempotency keys, revoked refresh tokens, stale rows |

Reservation release goes through `transitionOrder()` rather than writing status
directly, so stock and status can never disagree.

---

## 19. Errors and logging

### `AppError`

```ts
throw new AppError(ErrorCode.INSUFFICIENT_STOCK, {
  message: 'Only 3 packs of Aashirvaad Atta are left.',  // optional override
  internalMessage: 'store_variant 0f3… available=3 requested=5',
  details: [{ field: 'qty', message: 'Only 3 left' }],
  retryAfterSeconds: 30,
});
```

The HTTP status and default user copy come from the code. `internalMessage` is
logged and **never** serialised.

`errorHandler` maps `AppError` → its status; Zod errors → `400
VALIDATION_ERROR` with per-field `details`; Prisma known errors → the closest
domain code; anything else → `500 INTERNAL_ERROR` with the full stack logged
against the request id and nothing technical on the wire.

### Logging

Pino, structured JSON, `LOG_LEVEL` from the environment, `pino-pretty` in
development. `requestLogger` assigns or echoes `X-Request-Id` and stores it in
`AsyncLocalStorage`, so `moduleLogger('orders')` lines carry it automatically
without threading a logger through every signature.

Mobile numbers, OTPs, tokens and payment payloads are never logged.

---

## 20. Testing

```bash
npm test            # vitest run
npm run test:watch
```

| Suite | Covers |
|---|---|
| `tests/unit/shared.test.ts` | Money, distance, COD resolution, the state machine, phone normalisation |
| `tests/integration/auth*.test.ts` | OTP and password flows, rate limits, token rotation |
| `tests/integration/store.test.ts` | Serviceability boundaries, opening hours |
| `tests/integration/store-availability.test.ts` | Trading switch, hours editing, switch-off is reversible |
| `tests/integration/order.test.ts` | Placement, pricing, idempotency, cancellation |
| `tests/integration/payment.test.ts` | Create, verify, webhook signature, refund |
| `tests/e2e/order-lifecycle.test.ts` | Login → browse → cart → checkout → pay → track → deliver |

Integration and e2e suites run against a real PostgreSQL database via
supertest. `tests/global-setup.ts` migrates, `tests/setup.ts` truncates between
tests, and `tests/helpers/` provides an authenticated API client and fixtures.

**The database name must end in `_test`** — the environment loader refuses to
run otherwise.

---

## 21. Performance notes

- **Indexes match query shape.** `@@index([storeId, status, createdAt])` exists
  because the admin board filters on store + status and sorts by recency, in
  that order.
- **Partial indexes** where a job only ever scans a small subset — the
  pending-payment reservation index is the example.
- **Cursor pagination** everywhere a list is read while rows are inserted.
- **`limit + 1` fetches** instead of a second `COUNT`.
- **Config and store-open are cached**, since they are read on nearly every
  request and change rarely.
- **Search is Postgres**: `tsvector` full-text plus `pg_trgm` for fuzzy
  matching, with the query term bounded to 80 characters because it reaches
  both a `tsquery` and a trigram scan.
- **Compression** is on; images are served from object storage or a CDN in
  production, never through the API.

---

## 22. Extension points

The architecture was chosen so that the following are **additions, not
rewrites**:

| Future capability | What it takes |
|---|---|
| A second store | `StoreVariant` already scopes price and stock per store; add store resolution to serviceability and the order path |
| Another vertical (Café, Pharmacy, Clothing) | `CatalogVertical` already exists on `Category`. Vertical-specific behaviour branches on it, never on a category name |
| A new role (`STORE_MANAGER`, `DELIVERY_AGENT`) | A map entry in `permissions.ts` |
| A different SMS / payment / storage vendor | One new adapter in `infra/`. No service changes |
| Weight-based selling | `UnitType` and `unitValue` already model it |
| A job queue | Jobs are already idempotent and side-effect-scoped; move them to a worker process |
| A search service | Implement `SearchProvider` |
| Reviews, wishlist, referrals | Feature flags already exist in the config registry and are off by deliberate decision, not by omission |
