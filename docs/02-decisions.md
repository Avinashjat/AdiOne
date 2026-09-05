# AdiOne — Decision Record

**Task:** 1.1 (and decisions taken during Tasks 0.2–1.2)
**Date:** 2026-08-14
**Status:** Locked — applied throughout the build

Decisions taken under the instruction to proceed without stopping for
approval. Each records what was chosen, why, and what it would cost to change
later. Anything marked **Reversible: cheap** can be changed without touching
code already written.

---

## A. Project structure

### A1 — Three independent project folders, not a monorepo
`/backend`, `/web`, `/mobile`, each with its own `package.json` and
`node_modules`. **Directed by the user.**

The shared contract (enums, order state machine, error codes, wire DTOs, pure
business helpers, design tokens) is defined once in `backend/src/shared/` and
mirrored into `web/src/shared/` and `mobile/src/shared/` by
`npm run sync:shared`.

**Why the mirror rather than duplication:** the order status enum and the COD
resolver must mean the same thing in all three projects. Without a linked
package the only alternatives are hand-duplicated files (guaranteed to drift)
or a generated copy with a staleness check. The copies carry a
`GENERATED — DO NOT EDIT` banner, are committed so each project builds from a
fresh clone, and CI runs `npm run sync:shared -- --check`.

**Trade-off, stated plainly:** a workspace package makes drift impossible at
build time; copying makes it possible if someone skips the sync. Accepted in
exchange for genuinely independent installs, CI and deploys — and no Metro
`watchFolders` or hoisting problems in React Native, which is the single most
common source of monorepo pain with Expo.

**Constraint this imposes:** everything in `shared/` must stay dependency-free
and platform-neutral — no Node built-ins, no Prisma, no Express, no React — so
the identical file runs under Node, in a browser and under Hermes.

---

## B. Decisions from PRD §20.2

| # | Decision | Chosen | Rationale | Reversible |
|---|---|---|---|---|
| **O1** | Mobile state management | **Zustand + TanStack Query** | TanStack Query owns *server* state (products, cart, orders): caching, retries, stale-while-revalidate, offline — which is the genuinely hard part on rural 3G. Zustand owns the small *client* state (tokens, chosen address, language). Redux Toolkit is ~3× the boilerplate for state this simple; plain Context re-renders a product grid too broadly. | Cheap until Phase 14 |
| **O2** | Bottom-nav tabs | **Home · Categories · Search · Cart · Account** | The mockups disagree with each other (some show Orders in slot 4, some Cart). Cart needs a badge and one-tap access far more than Orders does. Orders is reachable from Account **and** from a persistent live-order banner above the tab bar, so it is never more than one tap away while an order is active. | Cheap |
| **O3** | OTP provider | **MSG91** (`console` stub for dev) | India-native, DLT template support, materially cheaper per SMS than Twilio. Behind `OtpProvider`, so switching is one class. | Cheap — port exists |
| **O4** | Admin login | **Email + password** (bcrypt, TOTP-ready) | A store owner opening the panel at 7 a.m. should not need to wait for an SMS, and every login would otherwise cost an SMS. Customers remain OTP-only; the `users` table carries a nullable `password_hash` used only by staff roles. | Cheap |
| **O5** | Payment provider | **Razorpay** (`mock` for dev) | Best Indian documentation and UPI coverage. Cashfree is an equally valid alternative. Behind `PaymentProvider`. **The mockup's UPI / Card / PhonePe / GPay / Paytm list is one PSP integration, not five** — those are methods inside the provider's checkout sheet. | Cheap — port exists |
| **O6** | Referral programme | **Disabled** (`FEATURE_REFERRAL_ENABLED=false`) | The mockup implies a wallet/credit ledger with an obvious self-referral fraud surface — real financial code, ~2 weeks. The screen ships informational-only behind the flag. | Cheap — config flag |
| **O7** | Ratings & wishlist | **Disabled** (`FEATURE_RATINGS_ENABLED=false`, `FEATURE_WISHLIST_ENABLED=false`) | "★ 4.5 (12.5K)" on a store with zero reviews is fabricated data shown to customers. Wishlist is low value at ~300 SKUs; "Reorder" from order history serves the same need. | Cheap — config flags |
| **O8** | Delivery promise copy | **"in 30 minutes"** | 10 km at a realistic 25 km/h is 24 minutes of riding before anyone picks an item, so the mockup's "10 minutes" cannot be met on most orders. Stored as `DELIVERY_PROMISE_TEXT`; **every screen renders the server-computed per-order ETA**, and no delivery time is ever hardcoded in UI copy. | Cheap — config value |
| **O9** | React Native tooling | **Expo (managed + dev-client)** | OTA updates via EAS let a copy or logic fix ship without a Play review — genuinely valuable in month one. Managed builds avoid owning Gradle. Bare RN CLI means maintaining native projects for no benefit at this scope; `expo prebuild` is the escape hatch if a native module ever demands it. | Moderate — decide before Phase 14 |
| **O10** | ORM / migrations | **Prisma 5** | Best-in-class TypeScript inference and a migration workflow that is hard to misuse; `schema.prisma` doubles as living documentation. Known gap — no native `SELECT … FOR UPDATE` — is handled with `$queryRaw` inside `$transaction`, a few lines in one helper, not an architectural problem. Drizzle was the runner-up. | Expensive after Phase 4 |
| **O11** | Store location & business values | **Sikar, Rajasthan 332001 — 27.6094, 75.1399** as seed placeholders | Taken from the mockups' addresses. **These are placeholders.** They are seed data in the `configurations` and `stores` tables, editable from the admin Configuration screen without a redeploy, so replacing them with the real shop's coordinates is a form submission, not a code change. | Cheap — data |
| **O12** | GST registration | **Assumed NOT registered** (`STORE_GSTIN=""`) | The receipt is labelled "Order Receipt" rather than "Tax Invoice". Setting `STORE_GSTIN` in configuration switches on the tax-breakdown rendering. Prices are tax-inclusive either way, and tax is **extracted** for display, never added on top. | Cheap — config value |

---

## C. Technical decisions taken during implementation

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Money is `Int` paise**, not `BigInt`, not `Decimal`, never float | ₹290.00 is `29000`. `Int` caps at ₹21,474,836 per column — orders of magnitude above any grocery order or price. `BigInt` would push BigInt handling through every DTO and JSON serialiser for no usable range. Aggregates use `SUM()`, which Postgres widens to bigint itself. |
| **D2** | **One self-referencing `categories` table**, not Categories + Subcategories | Two fixed levels cannot express Café → Beverages → Cold Coffee or Pharmacy → OTC → Painkillers. `depth 0` is what the UI calls a category, `depth 1` a subcategory, and deeper levels come free. A materialised `path` makes "everything under Grocery" an indexed prefix scan instead of a recursive CTE. Deviation from the spec, justified in PRD §8.3. |
| **D3** | **`store_variants` holds price *and* stock** per (store, variant), replacing a standalone `Inventory` table | One row answers the question every hot query asks: "can this customer buy this variant right now, and for how much?" Both fields are store-scoped, change together and are always read together. Splitting them adds a join to the busiest query in the app and gives multi-store two places to get wrong. Deviation from the spec, justified in PRD §8.4. |
| **D4** | **COD is a 3-state enum** (`ALLOW`/`DENY`/`INHERIT`) resolved outward, most restrictive wins | "Fresh vegetables are not COD" becomes: set the Vegetables category's `allow_cod = DENY`. Zero code changes, zero category names in code. The resolved value is snapshotted per line into `order_items.allow_cod_resolved`, so a dispute is auditable. |
| **D5** | **12 internal statuses, mapped to a 5-step customer timeline** | The mockup timeline has no "Packed" state; `PREPARING` and `READY_FOR_PICKUP` both present as one step. Mapping in `toCustomerTimelineStep()` means no client ever switches on a raw status string — the spec's "don't scatter status strings" rule applied to the frontend too. |
| **D6** | **Serviceability uses straight-line Haversine; ETA and delivery fee apply `ROAD_DISTANCE_FACTOR` (1.3)** | The promise we make is itself a straight-line statement ("we deliver up to 10 km from our store"). But roads are not straight: a customer 9.8 km away is inside the promise and is a ~13 km ride, and must be *priced and promised* accordingly. Conflating the two is a classic bug. |
| **D7** | **Coordinates are `Float`** (double precision), not `Decimal` | A double carries ~15 significant digits; lat/lng needs 9 for sub-metre accuracy. `Decimal` would drag Prisma's Decimal.js type into distance arithmetic for no gain. |
| **D8** | **`cart_items` stores no price column** | Price is always resolved live from `store_variants`. The "never trust client totals" rule expressed as schema: there is nowhere for a stale or tampered price to be stored in the first place. |
| **D9** | **`CacheStore` port with `memory` and `redis` drivers** | The development machine has no Redis and no Docker, and blocking all local work on infrastructure would be absurd. The env validator **refuses to boot in production** with `CACHE_DRIVER=memory`, because per-process state loses every OTP and rate-limit counter on restart. Same guard rejects `console` OTP, `mock` payments and `local` storage in production. |
| **D10** | **Constraints and partial indexes live in a hand-written `hardening` migration** | Prisma cannot express partial indexes, `CHECK` constraints, tsvector columns or trigram indexes. Rules such as "exactly one default address per user", "one active cart", `reserved_qty <= stock_qty` and `price <= mrp` are enforced by the **database**, not by application logic two concurrent requests can race. The `@@index` entries they replace were removed from `schema.prisma` so Prisma does not try to recreate them. |
| **D11** | **Full-text search uses the `simple` dictionary + `pg_trgm`**, not `english` | The corpus is brand names and Hindi transliterations — "Aashirvaad", "atta", "namkeen". English stemming mangles those and returns nothing useful. `products.search_keywords` carries local names so "cheeni" finds Sugar and "doodh" finds Milk — materially more valuable in this market than fuzzy English matching. **Verified working on seed data.** |
| **D11a** | Trigram matching must use **`<%` / `word_similarity()`**, not `%` / `similarity()` | `%` compares whole strings, so a short query against a long product name ("colgat" vs "Colgate Strong Teeth Toothpaste") scores below threshold and returns nothing — measured, not assumed. `word_similarity` compares the query against the best-matching *word span* in the name. Measured on seed data: `colgat` → Colgate 0.86, `maggie` → Maggi 0.71, `parle g` → Parle-G 1.00. The existing `gin_trgm_ops` index serves both operators. Task 4.3 combines FTS (`@@`) with `<%` as a fallback, and lowers `pg_trgm.word_similarity_threshold` so heavier misspellings ("asirvad") also match; `search_keywords` covers the rest. |
| **D12** | **`READ COMMITTED` + explicit `SELECT … FOR UPDATE` ordered by `variant_id`** | Correctness on the critical path comes from explicit row locks taken in a deterministic order (which is what prevents deadlocks between concurrent checkouts), not from a higher isolation level. `SERIALIZABLE` would add retry-on-conflict handling everywhere for no gain. Transaction timeout is 10 s rather than Prisma's 5 s default because order creation locks several inventory rows and waiting beats failing a paying customer. |
| **D13** | **Webhook raw-body parser is mounted above `express.json()`** | Payment signatures are an HMAC over the exact bytes. Parsing to JSON and re-stringifying changes key order and whitespace, and the signature then never matches. Ordering in `app.ts` is load-bearing, not stylistic. |
| **D14** | **Body size 1 MB, images never through the JSON body** | Uploads go via presigned URLs to object storage. |
| **D15** | **Local dev database** `postgresql://postgres:admin@localhost:5432/adione` | Supplied by the user. Lives in `backend/.env`, which is git-ignored; `backend/.env.example` documents it. `JWT_SECRET` and `OTP_PEPPER` were generated as 48 random bytes on setup, not copied from the example. |

---

## D. Deferred, with the reason

These were considered and consciously not built. Each is cheap to add later
because the seam already exists.

| Deferred | Seam that makes it cheap later |
|---|---|
| Redis in local dev | `CacheStore` port — flip `CACHE_DRIVER=redis` |
| Real SMS / payments / S3 | `OtpProvider`, `PaymentProvider`, `StorageProvider` ports |
| Meilisearch / Elasticsearch | `SearchProvider` port |
| Delivery-agent app | `DELIVERY_AGENT` role in the RBAC map, `delivery_agents.user_id` column, and the Task 10.2 contract |
| Multi-store | Every table is already `store_id`-scoped; `configurations` already supports per-store overrides |
| Prescription approval (V4) | The state machine is a data table — a `PENDING_PRESCRIPTION_APPROVAL` state is a map entry |
| Holiday closures | `store_closures` table exists; only the admin UI is missing |
| Item substitution on short-pick | `stock_ledger` + partial-refund path already modelled |
