# AdiOne — Product Requirements & Architecture (V1)

**Document:** 01 — PRD and Architecture
**Task:** 0.1
**Status:** For review / approval
**Date:** 2026-08-14
**Scope:** V1 — Grocery & Daily Essentials, one store, ~10 km radius, store-managed delivery

> This document contains **no code**. It is the contract that Tasks 0.2 → 17.3 are built against.
> Section 20 lists the decisions that must be confirmed before Task 1.1 proceeds.

---

## Table of contents

1. [Executive summary & product philosophy](#1-executive-summary--product-philosophy)
2. [Requirements analysis: gaps, conflicts, and recommendations](#2-requirements-analysis-gaps-conflicts-and-recommendations)
3. [V1 scope — in and out](#3-v1-scope--in-and-out)
4. [User journeys](#4-user-journeys)
5. [Admin / store journeys](#5-admin--store-journeys)
6. [System architecture](#6-system-architecture)
7. [Technology stack & justification](#7-technology-stack--justification)
8. [Database architecture](#8-database-architecture)
9. [API architecture](#9-api-architecture)
10. [Mobile app architecture](#10-mobile-app-architecture)
11. [Admin web architecture](#11-admin-web-architecture)
12. [Monorepo folder structure](#12-monorepo-folder-structure)
13. [Security architecture](#13-security-architecture)
14. [Payment architecture](#14-payment-architecture)
15. [Location, serviceability & ETA architecture](#15-location-serviceability--eta-architecture)
16. [Order lifecycle](#16-order-lifecycle)
17. [Business rules reference](#17-business-rules-reference)
18. [Scalability strategy (V1 → V6)](#18-scalability-strategy-v1--v6)
19. [Development roadmap & complexity estimate](#19-development-roadmap--complexity-estimate)
20. [Critical risks, mitigations & open decisions](#20-critical-risks-mitigations--open-decisions)

---

## 1. Executive summary & product philosophy

### 1.1 What we are building

AdiOne is a hyperlocal quick-commerce platform for a small-city / town market. A customer opens a mobile app, the app confirms they are inside the store's delivery radius, they browse grocery and daily-essential products, add to cart, choose an address, pay online or by cash on delivery, and a delivery boy employed by the store brings the order. The store owner runs everything from a web panel: accepting orders, managing stock and prices, assigning delivery boys, and changing business settings.

Three components ship in V1:

| Component | Audience | Platform |
|---|---|---|
| Customer app | Local residents | React Native (Android-first, iOS from same codebase) |
| Store/Admin panel | Store owner + 1–2 staff | Responsive web (React + Vite) |
| Backend API | Both | Node.js + Express + TypeScript + PostgreSQL |

### 1.2 The one-sentence philosophy

> **V1 must be boring, correct, and fast — and the code underneath must be general enough that Vegetables, Café, Pharmacy and Clothing are configuration + a new UI section, not a rewrite.**

Two failure modes are being explicitly designed against:

- **Failure mode A — the throwaway prototype.** Grocery-specific fields, hardcoded `10`, hardcoded status strings, price maths in the app. Adding vegetables means rewriting checkout.
- **Failure mode B — the cathedral.** Microservices, Kafka, Kubernetes, an ML recommender, and a promotions rules-engine, for a store doing 40 orders a day. It never launches.

The line we hold: **the domain model is general from day one; the infrastructure is deliberately small.** One Postgres, one Node process, one Redis. Generality lives in the schema and the service boundaries, not in the deployment diagram.

### 1.3 Success criteria for V1

| # | Criterion | Target |
|---|---|---|
| 1 | Correct inventory | Zero oversells under concurrent checkout (proven by a concurrency test) |
| 2 | Correct payments | Zero orders marked paid without server-verified payment; zero double-charges |
| 3 | No duplicate orders | Double-tap / retry on 3G never creates two orders |
| 4 | Ordering speed | Home → order placed in ≤ 6 taps for a repeat customer |
| 5 | Performance | Home screen interactive < 2.5 s on a ₹8,000 Android phone on 3G |
| 6 | Store usability | Owner can accept an order in ≤ 2 clicks and hears an audible alert for new ones |
| 7 | Extensibility | Adding the "Vegetables" vertical touches seed data + one UI section, no schema migration to core order/payment tables |

### 1.4 Priority order (used to settle every trade-off in this document)

Reliability → Simplicity → Easy ordering → Fast performance → Correct inventory → Correct payments → Correct order management → Easy admin → Scalability → Security.

Security sits last on that list in the source brief; in practice we treat **payment integrity, auth, and personal-data protection as non-negotiable** and read the ordering as "don't add speculative security infrastructure", not "ship insecure".

---

## 2. Requirements analysis: gaps, conflicts, and recommendations

This is the "tell me directly if my idea has a problem" section. Nothing here blocks starting work; each item has a recommendation and a proposed V1 answer.

### 2.1 Conflicts found between the written spec and the UI mockups

| # | Conflict | Why it matters | Recommendation |
|---|---|---|---|
| C1 | **Delivery promise is inconsistent**: splash says "delivered in **10 minutes**", login and About say "**30 minutes**", checkout says "Delivery in 10 mins", tracking says "10 mins". | Over a 10 km radius with store-managed riders, 10 minutes is physically impossible — 10 km at a realistic 25 km/h is 24 minutes of riding alone, before picking and packing. Promising 10 minutes guarantees a broken promise on most orders, which is the fastest way to lose a small-town customer base built on word of mouth. | **Never hardcode a delivery time in UI copy.** Every screen renders the server-computed ETA. Set marketing copy to a defensible band — recommend "**in 30 minutes**" as the headline, with the real per-order ETA shown at checkout. A 10-minute ETA can legitimately appear for a customer 800 m away; it must be computed, not printed. |
| C2 | Mockup checkout shows a **"Platform Fee ₹5"** line. The spec's config list has delivery fee but no platform fee. | An uncapturable fee line in the UI with no config behind it becomes a hardcoded `5`. | Add `PLATFORM_FEE_PAISE` to Configuration; render the line only when > 0. |
| C3 | Mockups show **star ratings with review counts** ("★ 4.5 (12.5K)"). Not in the spec. There is no review system, and a brand-new single store has no reviews. | Displaying "12.5K ratings" on day one is fabricated data shown to customers. | **Remove ratings from V1 UI.** Reviews are a V2+ feature with real moderation cost. Schema leaves room (`products.attributes`), UI does not render it. |
| C4 | Mockups show a **wishlist heart** on product cards. Not in the spec. | Small feature, but it needs a table, endpoints, sync, and an empty state. | **Defer to V1.5.** Remove the heart from V1 cards. Low value for a 300-SKU grocery store; "Reorder" from order history serves the same need better. |
| C5 | Mockups show a full **Refer & Earn screen** with "Total Rewards ₹250" and "You get ₹50" — i.e. a referral programme **and a wallet/credit ledger**. Not in the spec at all. | A credit ledger that can pay for orders is real financial code: balance, holds, expiry, refund interaction, and an obvious self-referral fraud target. This is easily 2 weeks of careful work. | **Defer the earning/wallet mechanics.** Task 14.15 ships the screen with referral **code + share link + "how it works"** and a rewards counter that reads `0` until the programme launches — or, cleaner, is gated behind a config flag `FEATURE_REFERRAL_ENABLED=false` and hidden. Decide at Task 1.1. |
| C6 | Mockup Order Details for a **delivered** order shows a "**Change Address**" link; the tracking screen shows one too. | Changing the address after placement invalidates serviceability, distance, delivery fee and ETA — and is meaningless once delivered. | Remove from delivered/terminal orders. Allow address change **only before `STORE_ACCEPTED`**, and only via a flow that re-runs serviceability and re-prices delivery fee server-side. |
| C7 | Mockup offers strip advertises **three simultaneous promotions** ("FLAT 15% OFF above ₹499", "FREE DELIVERY above ₹299", "10% OFF all grocery"). | Overlapping stackable promotions is a rules engine, not a coupon table. Which one applies? Do they stack? | V1 ships **one coupon code per order**, non-stacking, plus the independent free-delivery threshold. The offers strip becomes banners that **apply a single code**. Document precedence in §17.4. |
| C8 | Mockup shows a **voice-search mic** in the search bar. | Needs speech permissions, a provider, and Hindi ASR to be useful. | Defer. Remove the mic icon in V1. |
| C9 | Mockup Order Details offers "**Download Invoice**". | A document labelled "invoice" carries GST/legal meaning if the store is GST-registered. | V1 generates an **order receipt** (HTML → PDF), labelled "Receipt", showing a tax breakdown only if `STORE_GSTIN` is configured. Rename the button "Order Receipt" unless the store is registered. |
| C10 | Mockup product detail says "**MRP (Incl. of all taxes)**" while the spec asks for a separate "Taxes if applicable" line at checkout. | If MRP is tax-inclusive, adding tax on top at checkout double-charges. | Prices are **tax-inclusive** (Indian retail norm). Tax is **extracted for display**, never added. Checkout's tax line shows the included component. See §17.2. |
| C11 | Category mockup shows **Vegetables, Fruits, Dairy** tiles on Home, but V1 scope is grocery only. | A tile that leads to an empty category looks broken. | Categories are data. Ship only categories that have stock; the Home row renders whatever is active. Vegetables/Fruits appear when V2 seeds them. |
| C12 | Bottom nav differs across mockups: some show **Home / Categories / Search / Cart / Account**, others **Home / Categories / Search / Orders / Account**. | The tab bar must be fixed and consistent. | Recommend **Home · Categories · Search · Cart · Account**, with Orders reached from Account **and** from a persistent post-order tracking banner. Cart needs a badge and one-tap access far more than Orders does. Confirm at Task 1.1. |

### 2.2 Requirements missing from the spec that V1 genuinely needs

| # | Gap | Why it can't be ignored | Proposed V1 answer |
|---|---|---|---|
| M1 | **Item unavailable after acceptance.** In grocery this happens daily — the shelf is empty when packing. | Without a defined behaviour, staff will cancel whole orders, or worse, silently short-ship. | V1: admin can **cancel the whole order** with a reason (customer notified), or **remove a line item** before `READY_FOR_PICKUP` → total recomputed → for prepaid orders a **partial refund** is issued automatically. Substitution ("send 1 kg Tata instead") is V1.5. |
| M2 | **Proof of delivery / COD cash reconciliation.** | COD will be the majority of orders. Money handed to a rider with no record is an unauditable loss. | `delivery_assignments.cash_collected_paise` + a **delivery OTP** (4-digit, shown to the customer in-app, entered by staff/rider to mark DELIVERED) for COD orders. Config-gated: `DELIVERY_OTP_REQUIRED_FOR_COD`. |
| M3 | **Account deletion must actually delete.** The mockup has a "Delete Account" button. | Google Play **requires** an in-app account-deletion path, and India's DPDP Act requires erasure on request. A button that does nothing is a store-listing rejection. | Implement soft-delete → anonymisation job: PII scrubbed (name, email, mobile hashed to a tombstone), orders retained with a pseudonymous user for financial records. Documented retention policy. |
| M4 | **Customer support contact.** Mockups say "Chat with us or call support". | There is no chat system in scope. | V1 = `tel:` link + WhatsApp deep link to the store number + order id prefilled. No chat. |
| M5 | **Minimum order enforcement UX.** Config exists; no screen shows it. | Customer hits "Place Order" and gets rejected. | Cart shows "Add ₹X more to place an order" from `MIN_ORDER_VALUE_PAISE`. Checkout button disabled below threshold. |
| M6 | **Store timezone.** | Store hours evaluated in server UTC will close the store at 2:30 PM IST. | `stores.timezone` (default `Asia/Kolkata`); all hour comparisons in store-local time. |
| M7 | **Push-notification transport.** Spec says "notification architecture supporting push" but names no service. | Order status updates are the app's main retention loop. | FCM (free, Android-first). `device_tokens` table from day one; provider behind the notification abstraction. |
| M8 | **Returns / damaged goods.** | Milk arrives spoiled — what happens? | V1 = manual: customer calls, admin cancels/refunds via the panel. No self-serve returns flow. Documented as policy, not code. |
| M9 | **Legal content.** T&C, Privacy Policy, Terms of Refund pages are linked from three mockup screens. | Play Store submission requires a hosted privacy policy URL. | Static pages served by the API (or a static site); links wired in V1. Content is the owner's responsibility — flag early, it blocks launch. |
| M10 | **Analytics.** Nothing in the spec measures anything. | Without funnel data you cannot tell whether the app is failing at location, at search, or at checkout. | V1: structured server-side event logs on key steps (serviceability check, add-to-cart, checkout start, order placed, order failed) written to the existing log stream. No third-party SDK. |
| M11 | **Order quantity limits.** Spec mentions "quantity limits" but not where they live. | Needed to stop one customer clearing the shelf. | `store_variants.max_qty_per_order` (default from config), enforced in cart and re-enforced at order creation. |

### 2.3 Places where we deliberately deviate from the written spec

Three, each justified in detail later. They are flagged here so approval is explicit.

| Deviation | Spec says | We recommend | Why |
|---|---|---|---|
| **D2 — Category tree** | Separate `Categories` and `Subcategories` tables | One `categories` table, self-referencing via `parent_id` | Two fixed levels cannot express Café → Beverages → Cold Coffee, or Pharmacy → OTC → Painkillers. A self-referencing tree gives unlimited depth with the same query cost, and "subcategory" simply means "a category whose parent is not null". Zero cost now, avoids a painful migration at V3. Details in §8.3. |
| **D3 — Inventory table** | `Inventory` as its own table | `store_variants` holding **price + stock + availability** per (store, variant) | Price and stock are both store-scoped, both change together, and are always read together (a listing needs both). Splitting them forces a second join on the hottest query in the app and creates two places to get multi-store wrong. One row = "this variant, offered in this store, at this price, with this much stock". This is how Shopify/commercetools model it. Details in §8.4. |
| **D5 — Order statuses** | 12 statuses, and a customer timeline of Placed → Confirmed → Packed → Out for delivery → Delivered | Keep all 12 **internal** statuses; add a **display-mapping layer** to the 5 customer-facing steps | The mockup's 5-step timeline is not the same set as the 12 internal states (there is no "Packed" state; `PREPARING` and `READY_FOR_PICKUP` both map to it). Mapping in one place stops the app from ever switching on raw status strings. Details in §16.4. |

---

## 3. V1 scope — in and out

### 3.1 Recommended V1 feature set (build this)

**Customer app**
- OTP login (mobile only), logout, session persistence, profile (name, email), account deletion
- Location permission → GPS detect → serviceability check → serviceable / not-serviceable routing
- Address book: add / edit / delete / set default, max 5, map-pin adjustment, serviceability validated per address
- Home: location bar, search entry, offer banners, category row, Popular Products, Best Sellers, Recently Added, Offers
- Category listing: subcategory sidebar, product grid, sort, in-stock filter, sticky cart bar
- Product detail with variants, MRP/price/discount, description, attributes, out-of-stock state + "Notify me"
- Search with typo tolerance and local-name aliases (`cheeni` → Sugar)
- Cart: variant-level line items, quantity stepper, server-authoritative totals, change notices
- Checkout: 4 steps (Address → Payment → Review → Place Order), single coupon code, idempotent submit
- Payments: online via one PSP (UPI / cards / wallets in that PSP's sheet) + conditional COD
- Orders: list, details, receipt, live tracking timeline with ETA, reorder
- Notifications: push for every order transition + payment failure/refund
- States: store closed, outside service area, offline, payment failed, order failed, empty cart, empty search
- Hindi/English language toggle (i18n scaffolding + full string extraction; Hindi strings can land during Phase 14)

**Admin panel**
- Login (email + password + TOTP-optional; see §20 open decision O4)
- Dashboard: today's orders, orders by status, today's sales, total sales, low-stock list
- Orders: 7 tabs, order cards, detail drawer, accept / reject / advance status / cancel, **audible new-order alert**, printable pick-slip
- Catalog: category & product & variant CRUD, image upload, price / discount / stock / availability edits, bulk stock update
- Delivery: agent CRUD, manual assignment, cash-collected entry
- Configuration: every business rule editable without redeploy
- Customers: list, order history, block

**Backend**
- All of the above, plus: config service, search abstraction, storage abstraction, payment abstraction, notification abstraction, order state machine, transactional order creation with stock reservation, idempotency, webhooks, structured logging, rate limiting, RBAC, seed + migration workflow, test suite

### 3.2 Explicitly NOT in V1

| Not building | Why |
|---|---|
| Ratings & reviews | No data, needs moderation. Mockup UI removed. |
| Wishlist / favourites | Low value at 300 SKUs; "Reorder" covers it. |
| Referral rewards / wallet credits | Financial ledger + fraud surface. Screen ships informational only (or hidden by flag). |
| Promotions rules engine | One coupon per order is enough. |
| Voice search | Needs Hindi ASR. |
| Live rider GPS on a map | Needs a rider app + tracking infra. Timeline + ETA is enough. |
| Delivery-agent mobile app | Backend contract designed (Task 10.2), app is V2+. |
| Automatic delivery assignment | One store, 2–3 riders — a human assigns better than an algorithm. |
| Multi-store | Schema is store-scoped throughout; no store-selection UI. |
| Scheduled delivery slots | Quick commerce is now-only. |
| Subscriptions (daily milk) | Strong V2 candidate for this market, but not V1. |
| In-app chat support | Phone + WhatsApp. |
| Loyalty programme | Later. |
| Recommendations / ML | "You may also like" = same-subcategory, in-stock, by rank. No model. |
| Elasticsearch / Meilisearch | Postgres FTS handles 10k SKUs comfortably. Interface is pluggable. |
| Microservices / Kubernetes / message queue | One modular monolith. See §18. |
| Prescription / pharmacy, café add-ons, loose-weight vegetables, clothing size-colour | V2–V5. Schema leaves room (`products.attributes`, `catalog_vertical`). |
| iOS launch | Codebase supports it; V1 launches Android-only (see §20 R11). |

---

## 4. User journeys

### 4.1 J1 — First-time customer, happy path (COD)

```
Install → Splash "Get Started"
  → Enter mobile (+91) ────────────────────────► POST /auth/send-otp
  → Enter 6-digit OTP  ────────────────────────► POST /auth/verify-otp  → tokens
  → "Allow location?"  [Allow]
      → GPS fix ───────────────────────────────► GET /store/serviceability?lat&lng
          ├── serviceable  → Home ("Sikar, Rajasthan 332001 · 3.2 km away")
          └── not serviceable → "Sorry, we don't deliver here" (dead-end + support link)
  → Home: tap "Atta, Rice & Dal"
  → Category listing → tap [+] on Aashirvaad Atta 5 kg ──► POST /cart/items
  → Sticky bar "2 items · ₹369 · Checkout"
  → Checkout step 1 Address
      → No address yet → "Use current location" → reverse-geocode → confirm pin
        → fill house/street/area/landmark → Save ───► POST /addresses (serviceability revalidated)
      → ETA banner "Delivery in ~28 mins"
  → Checkout step 2 Payment → COD  (shown only if every item allows COD)
  → Checkout step 3 Review → server-recomputed bill → optional coupon
  → Checkout step 4 [Place Order] ─────────────► POST /orders (Idempotency-Key)
      → button disabled + spinner until response
  → Order Confirmed screen → auto-route to Tracking
  → Push: "Order confirmed" → "Packed" → "Out for delivery" → "Delivered"
  → Rider arrives, customer reads out delivery OTP, pays cash → DELIVERED
```

### 4.2 J2 — Returning customer, online payment

```
Open app (session restored, silent refresh)
  → background serviceability re-check on last address
  → Home → Search "doodh" → Amul Taaza Milk 1 L → [+]
  → Cart → Checkout → default address preselected
  → Payment → UPI → [Continue] ────────────────► POST /payments/create → provider order id
  → PSP sheet (UPI app handoff) → success returns to app
  → App calls POST /payments/verify (client signal ONLY)
      Server verifies signature/status with provider ──► order → PAYMENT_CONFIRMED → ORDER_PLACED
      (Webhook is the authoritative path; verify is the fast path — see §14.4)
  → Tracking screen live via socket
```

### 4.3 J3 — Edge-case journeys (each has a designed screen)

| Journey | Trigger | Behaviour |
|---|---|---|
| **Location denied** | Permission refused | Non-blocking screen: "Enter your area manually" → pincode/area search → pin on map → serviceability. Never dead-end on a permission refusal. |
| **Outside service area** | `distanceKm > MAX_SERVICE_RADIUS_KM` | Browsing allowed (read-only catalogue), all Add buttons disabled with "We don't deliver here yet", plus "Notify me when you launch here" capture. Better than a hard wall: it collects demand data for the next store. |
| **Store closed** | Outside `store_hours` | Store-closed screen; browsing and cart building allowed; checkout blocked with next opening time. Matches mockup's "Plan Ahead!". |
| **Item went out of stock while in cart** | Cart revalidation | Cart shows a yellow strip: "Tata Salt 1 kg is out of stock and was removed". Order is never silently altered. |
| **Price changed while in cart** | Cart revalidation | "Price updated for 1 item" strip; new total shown; explicit re-confirm before Place Order. |
| **COD blocked** | Any item resolves `DENY` | COD row is visible but disabled with reason: "Cash on Delivery isn't available for Fresh Tomatoes". Never silently hidden. |
| **Payment failed** | PSP failure / abandonment | Order sits in `PENDING_PAYMENT`; screen offers Retry Payment (same order) or Cancel. Stock stays reserved until `PAYMENT_HOLD_MINUTES` expires. |
| **Below minimum order** | Subtotal < `MIN_ORDER_VALUE_PAISE` | Cart shows shortfall; checkout disabled. |
| **No internet** | Network error | Full-screen retry state on cold start; inline toast + retry elsewhere. Cart is cached locally so it survives. |
| **Duplicate tap** | Double tap on Place Order | Button disabled on first tap; idempotency key returns the same order rather than creating a second. |
| **Order rejected by store** | Admin rejects | Push + in-app "Order could not be accepted — <reason>"; auto-refund initiated for prepaid orders. |

---

## 5. Admin / store journeys

### 5.1 A1 — Order intake (the highest-frequency loop, optimise ruthlessly)

```
Panel open on a counter tablet, "New" tab
  → New order arrives via socket → row animates in + AUDIBLE CHIME (repeats until acknowledged)
  → Card shows: #AD…890 · Avinash Jat · ₹290 · UPI PAID · 3.2 km · 2 min ago
  → [Accept]  → status STORE_ACCEPTED → customer push "Order confirmed"
     [Reject] → reason picker (out of stock / too far / closing / other) → REJECTED
                → prepaid orders auto-queue a refund
  → [Print pick slip] → items grouped by aisle-ish sort order
  → [Preparing] → [Ready] → assign delivery boy → [Out for delivery] → [Delivered]
```

**Design constraints from real counter use:** ≤ 2 clicks to accept; nothing important behind a hover; readable at arm's length; works on a cheap Android tablet in Chrome; audible alert that survives a background tab; the panel must never lose a new order because a socket dropped (poll fallback every 20 s).

### 5.2 A2 — Stock & price management (daily)

```
Products → filter "Low stock" → inline edit stock qty → save (optimistic, with rollback)
Products → open product → variant rows → edit price / discount / max-per-order / availability
Bulk: select rows → "Mark out of stock" / "Set stock"
Every change writes stock_ledger + audit_logs (who, when, before → after)
```

### 5.3 A3 — Catalogue onboarding (setup-heavy, then rare)

```
Categories → add "Atta, Rice & Dal" (parent: Grocery) → image, display order
Products → New → name, name_hi, category, brand, description, keywords, tax rate, COD policy
        → Variants: "5 kg" → SKU, unit, MRP, price, stock, max per order
        → Images: upload (auto thumb/card/detail renditions)
        → Publish
```

### 5.4 A4 — Delivery management

```
Delivery → Agents → add (name, mobile, vehicle) → toggle active/available
Orders → Ready tab → order → "Assign to" → pick available agent → Out for delivery
On delivery → enter delivery OTP (COD) + cash collected → DELIVERED
Day end → "Cash to collect" report per agent
```

### 5.5 A5 — Configuration (rare but must never need a developer)

Every value in §17 is editable here: store location & radius, hours, min order, delivery-fee slabs, free-delivery threshold, platform fee, prep time, COD defaults & cap, cancellation window, ETA parameters, feature flags. Changes are audit-logged and take effect on the next request (config cache TTL 60 s, plus explicit invalidation on save).

---

## 6. System architecture

### 6.1 V1 deployment topology (text diagram)

```
        ┌──────────────────────┐        ┌───────────────────────┐
        │  Customer Mobile App │        │  Store / Admin Panel  │
        │  React Native (RN)   │        │  React + Vite (SPA)   │
        │  Android · iOS-ready │        │  Desktop + tablet     │
        └───────────┬──────────┘        └───────────┬───────────┘
                    │  HTTPS/JSON + WSS             │
                    └───────────────┬───────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │   Nginx / Caddy (TLS, gzip)   │
                    │   reverse proxy + static      │
                    └───────────────┬───────────────┘
                                    ▼
        ┌───────────────────────────────────────────────────────┐
        │        API — Node.js + Express + TypeScript            │
        │        (single modular-monolith process)               │
        │                                                       │
        │  HTTP layer   routes → validation(zod) → controllers   │
        │  Domain       auth · catalog · inventory · cart ·      │
        │               orders · payments · delivery ·           │
        │               notifications · config · admin           │
        │  Ports        PaymentProvider · OtpProvider ·          │
        │               NotificationProvider · SearchProvider ·  │
        │               StorageProvider                          │
        │  Data         repositories (Prisma)                    │
        │  Realtime     Socket.IO (order rooms)                  │
        │  Jobs         in-process scheduler:                    │
        │               release-expired-reservations,            │
        │               retry-notifications, payment-reconcile   │
        └───┬──────────────┬──────────────┬─────────────────┬────┘
            │              │              │                 │
            ▼              ▼              ▼                 ▼
    ┌──────────────┐ ┌───────────┐ ┌──────────────┐ ┌────────────────┐
    │ PostgreSQL   │ │  Redis    │ │ Object store │ │ External       │
    │ system of    │ │ OTP,      │ │ S3-compatible│ │ · PSP (Razorpay│
    │ record       │ │ rate limit│ │ (R2/S3/MinIO)│ │   or Cashfree) │
    │ (+ daily     │ │ config &  │ │ product      │ │ · SMS/OTP      │
    │  backups)    │ │ session   │ │ images + CDN │ │ · FCM push     │
    └──────────────┘ └───────────┘ └──────────────┘ └────────────────┘
```

### 6.2 Why a modular monolith, not microservices

At 40–500 orders/day, a single Node process on a 2 vCPU box is roughly two orders of magnitude over-provisioned. Microservices would add network failure modes, distributed transactions (exactly where correctness matters most — order + stock + payment), and deployment overhead, in exchange for scaling we do not need.

What we take from microservices without paying for them: **hard module boundaries**. Each domain module owns its tables and exposes a service interface; cross-module access goes through that interface, never through another module's repository. When a module genuinely needs to be extracted (realistically: search, or notifications), the seam already exists.

### 6.3 Layering rules (enforced by review, and by folder structure)

```
route → middleware (auth, rate limit) → validation (zod schema)
     → controller (HTTP shape only, no business logic)
     → service (ALL business rules, transactions, authority decisions)
     → repository (data access only, no rules)
     → Prisma / SQL
```

Non-negotiables:
- A controller never touches Prisma.
- A repository never decides anything (no "if out of stock" in a repository).
- Money, price, discount, tax, COD eligibility, serviceability and stock decisions live **only** in services, **only** on the server.
- Every provider (payment/OTP/push/search/storage) is used through its port interface; no SDK import outside `infra/<provider>/`.

### 6.4 Request path for the most critical operation (place order)

```
POST /api/v1/orders  [Idempotency-Key: uuid]
  1  rate limit (Redis)                                → 429
  2  auth middleware → req.user                        → 401
  3  zod validation of body                            → 422
  4  idempotency check (user_id, key)
        · COMPLETED → replay stored response           → 200 (no side effects)
        · IN_PROGRESS → 409 ORDER_IN_PROGRESS
        · new → insert IN_PROGRESS row
  5  BEGIN TRANSACTION  (READ COMMITTED)
       a  load store + config snapshot
       b  store open?                                  → 409 STORE_CLOSED
       c  address belongs to user? exists?             → 404 / 403
       d  checkServiceability(address, store)          → 422 OUT_OF_SERVICE_AREA
       e  load cart items
       f  SELECT … FROM store_variants
            WHERE (store_id, variant_id) IN (…)
            ORDER BY variant_id                        ← deterministic order = no deadlock
            FOR UPDATE                                 ← row locks held to COMMIT
       g  per item: variant active? product active?
                   available_qty >= qty?               → 409 ITEM_OUT_OF_STOCK
                   qty <= max_qty_per_order?           → 422 QTY_LIMIT_EXCEEDED
       h  price/discount/tax read from the locked rows (server authority)
       i  resolve COD eligibility (§17.3)              → 422 COD_NOT_ALLOWED
       j  coupon validate + compute discount
       k  subtotal, delivery fee, platform fee, tax, total  (server authority)
       l  total >= MIN_ORDER_VALUE?                    → 422 MIN_ORDER_NOT_MET
       m  reserve stock: reserved_qty += qty  (+ stock_ledger rows)
       n  INSERT orders (status = COD ? ORDER_PLACED : PENDING_PAYMENT)
          INSERT order_items (full immutable snapshot)
          INSERT order_status_history
       o  mark cart CONVERTED
       p  update idempotency row → COMPLETED + response snapshot
  6  COMMIT
  7  after commit (never inside the transaction):
       · emit socket event to store room + user room
       · enqueue notifications
       · for ONLINE: return provider order id from POST /payments/create
```

Everything that can fail or block on the network (PSP call, push, socket) happens **outside** the transaction. Nothing inside the transaction talks to a third party.

---

## 7. Technology stack & justification

| Layer | Choice | Why this, over the alternatives |
|---|---|---|
| Language | **TypeScript** everywhere | One language across API, admin, mobile and shared packages. Shared types (`packages/types`) make the client physically unable to invent a field the server doesn't send. |
| API runtime | **Node.js 20 LTS + Express 5** | Specified, and correct for this shape of work: I/O-bound, small team, huge ecosystem. Express 5 has native async error propagation (no `express-async-errors` hack). Fastify would be ~2× faster on synthetic benchmarks — irrelevant at this traffic, and Express has better middleware availability. |
| Database | **PostgreSQL 16** | Specified, and the right call: real transactions and row-level locking (required for the oversell problem), `tsvector` + `pg_trgm` full-text search good to ~10⁵ SKUs, JSONB for vertical-specific attributes, `earthdistance`/PostGIS available if geo ever needs indexing. |
| ORM / migrations | **Prisma** *(recommend; confirm at 1.2)* | Best-in-class TypeScript inference, first-class migration workflow, readable schema file that doubles as living documentation. Known limitation: no native `SELECT … FOR UPDATE` — handled with `$queryRaw` inside `$transaction`, which is a five-line helper, not an architectural problem. Alternative considered: **Drizzle** (closer to SQL, native locking) — a fine choice; Prisma wins on migration ergonomics and team familiarity. Knex/TypeORM: no. |
| Cache / ephemeral | **Redis 7** | OTP storage with TTL, rate-limit counters, config cache, Socket.IO adapter when we scale past one process. Deliberately **not** the system of record for anything. |
| Validation | **Zod** | Schema is the single source of truth: request validation + inferred TS types + shared between API and clients. |
| Auth | **JWT access (15 min) + rotating opaque refresh (30 d, hashed in Postgres)** | Stateless request path, revocable sessions, refresh-reuse detection. Full details §13.2. |
| Realtime | **Socket.IO** | Auto-reconnect and long-polling fallback matter on rural 3G far more than raw WebSocket efficiency. Redis adapter is a config change when we go multi-process. |
| Mobile | **React Native** (specified) — recommend **Expo (managed, with dev-client)** | Confirm at 0.2. Expo gives OTA updates via EAS (ship a copy fix without a Play review — genuinely valuable in month 1), managed builds without Android Studio on the dev machine, and first-class monorepo support in Metro. Escape hatch exists via prebuild/dev-client if a native module needs it. Bare RN CLI means owning Gradle upgrades for no benefit here. |
| Mobile state | **Zustand + TanStack Query** *(recommend; confirm at 1.1)* | TanStack Query owns all **server** state (products, cart, orders): caching, retries, offline behaviour, stale-while-revalidate — exactly the hard part on bad networks. Zustand owns the small amount of **client** state (auth tokens, chosen address, language, UI). Redux Toolkit would be ~3× the boilerplate for state this simple; plain Context re-renders too broadly for a product grid. |
| Navigation | **React Navigation v7** | Standard; native stack for performance on low-end Android. |
| Admin web | **React 18 + Vite + TypeScript + TanStack Query + Tailwind** | Fast dev loop, tiny build, no SSR needed (behind a login). |
| UI (mobile) | Hand-rolled design-system components on RN primitives | A UI kit would fight the mockups. Our component set is small and specified in Task 14.1. |
| Search | **Postgres FTS (`tsvector` + GIN) + `pg_trgm`** behind `SearchProvider` | Handles typos and prefix matching to ~10⁵ products. Meilisearch is a container we don't need to run yet, behind an interface we can switch to. |
| Object storage | **S3-compatible** behind `StorageProvider`; MinIO/local in dev, **Cloudflare R2** recommended in prod | R2 has zero egress fees and a built-in CDN — meaningful when the main payload is product images to mobile users. |
| Payments | **One PSP behind `PaymentProvider`** — Razorpay or Cashfree *(confirm 1.1)* | UPI/cards/wallets all arrive through one integration. We are **not** building five integrations (see §14.2). |
| OTP/SMS | **MSG91 or 2Factor** behind `OtpProvider` *(confirm 1.1)* | Both are India-native with DLT template support. Twilio is materially more expensive per SMS in India and adds DLT friction. |
| Push | **FCM** behind `NotificationProvider` | Free, Android-first. |
| Logging | **Pino** + request-id via `AsyncLocalStorage` | JSON logs, negligible overhead, Sentry-ready. |
| Testing | **Vitest + Supertest**, real Postgres test DB | Vitest: fast, native ESM/TS, Jest-compatible API. Concurrency tests need a **real** database — no mocks for the oversell test. |
| Containers | **Docker + docker-compose** | Postgres + Redis in dev; full stack in prod. Kubernetes is not in the conversation. |
| CI | GitHub Actions (lint, typecheck, test, build) | |

### 7.1 Hosting recommendation (V1)

A single 2 vCPU / 4 GB VPS (Hetzner/DigitalOcean/AWS Lightsail, Indian or Singapore region) running API + Nginx + Redis via compose, with **managed Postgres** (or self-hosted Postgres with automated `pg_dump` to object storage + a tested restore). Cost ≈ ₹1,500–3,000/month. The single most important production decision is not the host — it is that **backups are automated and a restore has actually been rehearsed** (§20 R12).

---

## 8. Database architecture

### 8.1 Design principles

1. **Money is `BIGINT` paise.** Never `FLOAT`, never `NUMERIC` for currency arithmetic in application code. `₹290.00` is `29000`. Column names carry the unit: `total_paise`.
2. **Orders are immutable snapshots.** `order_items` copies product name, variant name, brand, image, SKU, unit, MRP, price, tax rate and resolved COD flag at the moment of ordering. Renaming a product must never change a 6-month-old receipt.
3. **Everything is store-scoped from day one** — `store_id` on stores' data, inventory, carts and orders — even though there is one store. Multi-store then costs a store-picker, not a migration.
4. **Soft delete for anything referenced by an order**, hard delete for the rest. `deleted_at` + partial indexes excluding deleted rows.
5. **`created_at` / `updated_at` (timestamptz) on every table.** All timestamps stored in UTC; presentation converts to `stores.timezone`.
6. **Enums as Postgres enums**, mirrored in `packages/types`. No status strings typed by hand anywhere.
7. **Vertical-specific fields go in `products.attributes` JSONB**, never as new core columns. Shelf life, storage instructions, country of origin (grocery); prescription_required (pharmacy); crust/toppings (café). The core order pipeline never reads them.

### 8.2 Entity map (text ER)

```
users 1─────n addresses
  │  1─────n refresh_tokens
  │  1─────n device_tokens
  │  1─────1 carts (ACTIVE, per store)
  │  1─────n orders
  │  1─────n notifications
  │  1─────n back_in_stock_subscriptions
  │  1─────n coupon_redemptions

stores 1────n store_hours          (day-of-week open/close)
  │    1────n store_closures       (holidays — V2-ready, table exists)
  │    1────n store_variants
  │    1────n orders
  │    1────n delivery_agents

categories ──┐ (self-referencing tree: parent_id)
  └──────────┘
categories 1─n products
brands     1─n products
products   1─n product_variants
products   1─n product_images
product_variants 1─n store_variants        ── the sellable unit: (store, variant)
store_variants   1─n stock_ledger
store_variants   1─n cart_items
store_variants   1─n order_items (by variant_id + snapshot)

carts   1─n cart_items
orders  1─n order_items
orders  1─n order_status_history
orders  1─n payments  1─n refunds
orders  1─1 delivery_assignments  n─1 delivery_agents
orders  n─1 coupons (via coupon_redemptions)

configurations   (key, store_id) → jsonb value
idempotency_keys (user_id, key)
payment_events   (provider, event_id)  ← webhook replay guard
audit_logs
```

### 8.3 Deviation D2 — the category tree

```
categories
  id, store_id (null = global), parent_id → categories.id, 
  name, name_hi, slug, image_url, display_order, depth, path,
  vertical (GROCERY | VEGETABLES | CAFE | PHARMACY | CLOTHING | …),
  allow_cod (ALLOW | DENY | INHERIT), is_active, timestamps
```

`depth = 0` → what the UI calls a **Category** (Grocery, Vegetables, Dairy — the Home row).
`depth = 1` → what the UI calls a **Subcategory** (Atta Rice & Dal, Oil & Ghee — the sidebar).
`depth ≥ 2` → available for free when Café or Pharmacy needs it.

Products attach to a **leaf** category. `path` (materialised, e.g. `grocery/atta-rice-dal`) makes "all products under Grocery" a single indexed prefix query instead of a recursive join. `vertical` is what future verticals branch on — never a category **name**.

The spec's two-table shape would have forced either a schema migration or an ugly `sub_subcategories` table at V3. This costs nothing today.

### 8.4 Deviation D3 — `store_variants` (price + stock together)

```
store_variants
  id, store_id, variant_id,
  mrp_paise, price_paise,                  ← store-scoped pricing
  stock_qty, reserved_qty,                 ← store-scoped stock
  available_qty  GENERATED (stock_qty - reserved_qty) STORED,
  low_stock_threshold, max_qty_per_order,
  is_available, allow_cod, timestamps
  UNIQUE (store_id, variant_id)
  CHECK (price_paise <= mrp_paise)
  CHECK (stock_qty >= 0 AND reserved_qty >= 0 AND reserved_qty <= stock_qty)
```

This one row answers the question every hot query asks: *"can this customer buy this variant right now, and for how much?"* Splitting price and stock into two tables would put a second join on the product-listing query and give multi-store two places to go wrong.

`reserved_qty` is the mechanism that makes the online-payment window safe: stock is reserved at order creation, committed on payment confirmation, and released by a background job if payment doesn't complete within `PAYMENT_HOLD_MINUTES` (default 10).

### 8.5 Full table list

| Table | Purpose | Notes |
|---|---|---|
| `users` | Customers + admins | Unique `mobile` (E.164 digits), `role`, `status`, `referral_code` |
| `refresh_tokens` | Session families | `token_hash` only; rotation + reuse detection |
| `addresses` | Saved addresses | lat/lng, cached `is_serviceable` + `distance_km`, max 5 enforced in service |
| `stores` | Store entity | lat/lng, `timezone`, `allow_cod`, radius override |
| `store_hours` | Weekly hours | `(store_id, day_of_week)` unique |
| `store_closures` | Holidays | Table exists in V1, UI in V2 |
| `categories` | Self-referencing tree | §8.3 |
| `brands` | Brand master | Searchable |
| `products` | Catalogue item | `attributes` JSONB, `search_keywords[]`, `tax_rate_bp`, `allow_cod` |
| `product_variants` | Sellable variation | 1 kg / 5 kg / 500 ml; unique SKU |
| `product_images` | Renditions | `url`, `thumb_url`, `card_url`, ordering |
| `store_variants` | **Price + stock per store** | §8.4 |
| `stock_ledger` | Every stock movement | Reason, delta, balance-after, actor, order ref |
| `carts` / `cart_items` | Active cart | **cart_items stores no price** — price is always resolved live. The "never trust client totals" rule expressed in schema. |
| `coupons` / `coupon_redemptions` | Single-code discounts | Per-user and total usage limits |
| `orders` | Order header | `order_number` (`AD…`), money columns, distance, ETA, timestamps per state, `idempotency_key` |
| `order_items` | Immutable line snapshot | Includes `allow_cod_resolved` — how the decision was made is auditable |
| `order_status_history` | Every transition | from → to, actor type, reason |
| `payments` | PSP attempts | Unique `(provider, provider_payment_id)` |
| `payment_events` | Webhook log | Unique `event_id` = replay guard |
| `refunds` | Refund attempts | Linked to payment + order |
| `delivery_agents` | Riders | `is_active`, `is_available` |
| `delivery_assignments` | Order ↔ rider | Delivery OTP hash, `cash_collected_paise` |
| `notifications` | Outbox + in-app feed | `status` QUEUED/SENT/FAILED, retryable |
| `device_tokens` | FCM tokens | Per user per device |
| `configurations` | Business config | `(key, store_id)`, `is_public` flag for app-safe values |
| `idempotency_keys` | Duplicate suppression | Stores response snapshot |
| `back_in_stock_subscriptions` | "Notify me" | Unique per (user, variant) while unnotified |
| `audit_logs` | Admin actions | before/after JSONB |

### 8.6 Indexing decisions (and the reasoning)

Indexes are chosen from the actual query list, not sprinkled. Each one below has a named query it serves.

| Index | Serves | Reasoning |
|---|---|---|
| `users(mobile)` UNIQUE | Login | Every OTP request. Uniqueness is also the business rule. |
| `refresh_tokens(token_hash)` UNIQUE | Token refresh | Single-row lookup on every refresh. |
| `refresh_tokens(user_id, expires_at)` | Logout-all, cleanup | Range scan per user. |
| `addresses(user_id) WHERE deleted_at IS NULL` | Address list | Partial: deleted rows are never listed, so they don't belong in the index. |
| `addresses(user_id) UNIQUE WHERE is_default AND deleted_at IS NULL` | Default address | Enforces "exactly one default" **in the database**, not in application logic that can race. |
| `categories(parent_id, display_order) WHERE is_active` | Home row, sidebar | The two highest-frequency catalogue reads. |
| `categories(path) text_pattern_ops` | "All products under Grocery" | Prefix match on a materialised path beats recursive CTE at this size. |
| `products(category_id, status)` | Category listing | Composite in filter order. |
| `products USING GIN (search_vector)` | Full-text search | `tsvector` over name + brand + keywords + name_hi. |
| `products USING GIN (name gin_trgm_ops)` | Typo tolerance | `pg_trgm` catches "asirvad" → "Aashirvaad". Real users on phone keyboards. |
| `product_variants(product_id)` | Product detail | |
| `product_variants(sku)` UNIQUE | Admin lookup, barcode | |
| `store_variants(store_id, variant_id)` UNIQUE | **The order-creation lock query** | Also the natural key. Critical: `SELECT … FOR UPDATE ORDER BY variant_id` uses it, and deterministic ordering is what prevents deadlocks between concurrent checkouts. |
| `store_variants(store_id) WHERE is_available AND available_qty > 0` | In-stock listing/filter | Partial index — out-of-stock rows aren't in it at all, so the common query touches a much smaller index. |
| `store_variants(store_id, available_qty) WHERE available_qty <= low_stock_threshold` | Dashboard low-stock | Partial: the dashboard reads a handful of rows, not a table scan. |
| `cart_items(cart_id, variant_id)` UNIQUE | Add-to-cart upsert | Makes "increment if present" a single `ON CONFLICT` statement. |
| `carts(user_id, store_id) UNIQUE WHERE status='ACTIVE'` | One live cart per user per store | Constraint, not convention. |
| `orders(store_id, status, created_at DESC)` | **Admin order tabs** | The panel's primary query, run every few seconds. Column order matches the filter → sort shape exactly. |
| `orders(user_id, created_at DESC)` | My Orders | Paginated, newest first. |
| `orders(order_number)` UNIQUE | Support lookup | |
| `orders(user_id, idempotency_key)` UNIQUE | Duplicate order prevention | The **database** is the arbiter of "already placed", not a mutex in app memory. |
| `orders(status, created_at) WHERE status='PENDING_PAYMENT'` | Reservation-release job | Partial index over a tiny set; the job stays O(pending) forever. |
| `order_items(order_id)` | Order detail | |
| `order_status_history(order_id, created_at)` | Tracking timeline | |
| `payments(provider, provider_payment_id)` UNIQUE | Webhook idempotency | Makes double-capture impossible at the storage layer. |
| `payment_events(provider, event_id)` UNIQUE | Webhook replay guard | PSPs retry; this makes retries free. |
| `notifications(status) WHERE status='QUEUED'` | Outbox drain | Partial. |
| `notifications(user_id, created_at DESC)` | In-app feed | |
| `delivery_assignments(order_id) UNIQUE WHERE status <> 'CANCELLED'` | One active rider per order | |
| `stock_ledger(store_variant_id, created_at DESC)` | Stock audit trail | |
| `configurations(key, store_id)` UNIQUE | Config lookup | Cached in Redis with 60 s TTL anyway. |

**Deliberately not indexed:** `order_items.variant_id` (no query filters by it in V1 — "top products" is a V2 report and gets its index then), free-text `description`, and every `updated_at`. Unused indexes are pure write cost on the hottest tables.

### 8.7 Where transactions are required (and where they are forbidden)

| Operation | Transaction | Isolation / locking | Why |
|---|---|---|---|
| **Place order** | Yes — one transaction | `READ COMMITTED` + `SELECT … FOR UPDATE` on `store_variants` ordered by `variant_id` | The oversell problem. Row locks held from check to reservation make two concurrent buyers of the last unit serialise. Deterministic lock ordering prevents deadlock. |
| **Payment confirmation** | Yes | Lock order row `FOR UPDATE`; unique `(provider, provider_payment_id)` | Webhook and client-verify can arrive simultaneously; both paths must converge on one state change. Commit reservation → stock. |
| **Refund** | Yes | Lock order + payment | Payment status, order status and refund row must move together. |
| **Order status transition** | Yes | Lock order row | Read-modify-write on `status` + history insert; two admins clicking at once must not both succeed. |
| **Stock adjust (admin)** | Yes | `FOR UPDATE` on the row | Ledger + balance must agree. |
| **Reservation release (job)** | Yes, per order | `FOR UPDATE SKIP LOCKED` | Job must not fight live checkouts. |
| **Address default change** | Yes | Unset-then-set | Guarded additionally by the partial unique index. |
| Catalogue reads, search, listings | **No** | — | Read-only. |
| Sending push/SMS, PSP calls, socket emits | **Never inside a transaction** | — | Third-party latency must never hold a database lock. All are post-commit. |

### 8.8 Migration & seed strategy

- Every schema change is a **checked-in, forward-only migration**. No `db push` outside a scratch database.
- Naming: `NNN_verb_subject` (`001_init_core`, `002_add_store_closures`).
- Deploy order: run migrations → then deploy code. Every migration must be safe against the **previous** version of the code running (expand/contract: add nullable → backfill → make required in a later migration).
- Seeds split into **reference** (idempotent, runs in every environment: configurations, store, categories) and **demo** (dev/staging only: sample products, test users). Production never gets demo data.
- Local dev DB: `postgresql://postgres:admin@localhost:5432/adione`, supplied via `DATABASE_URL` in `.env` (never committed; `.env.example` documents it).

---

## 9. API architecture

### 9.1 Conventions

- Base path **`/api/v1`**. Version in the path, because a mobile app in the wild cannot be forced to upgrade.
- REST, plural nouns, verbs only for genuine actions (`/orders/:id/cancel`).
- `POST` creates, `PATCH` partially updates, `PUT` never used.
- Auth: `Authorization: Bearer <access_token>`.
- Idempotency: `Idempotency-Key: <uuid>` required on `POST /orders` and `POST /payments/create`.
- All list endpoints are paginated. **Cursor** pagination for catalogue and orders (stable under insertions); page/limit only where a total count is genuinely needed (admin tables).
- All timestamps ISO-8601 UTC with `Z`. Client formats in store timezone.
- All money in **paise**, integer, field suffix `_paise`. The client formats; the client never computes.

### 9.2 Response envelope

```jsonc
// success
{ "success": true,
  "data": { /* … */ },
  "meta": { "requestId": "req_…", "nextCursor": "…" } }

// error
{ "success": false,
  "error": {
    "code": "ITEM_OUT_OF_STOCK",          // stable machine code — clients switch on this
    "message": "Tata Salt 1 kg is out of stock",  // safe to show to the user
    "details": [ { "variantId": "…", "available": 0 } ],
    "requestId": "req_…"
  } }
```

Two rules that make the whole app's error handling tractable:
1. **`code` is stable and enumerated** in `packages/types`. Clients never parse `message`.
2. **`message` is always user-safe.** Internal detail (stack, SQL, provider payload) goes to logs keyed by `requestId`, never to the client. The mockups' "user-friendly messages, not technical errors" requirement is satisfied at the protocol level, not by app-side string mapping.

### 9.3 Error code catalogue (initial)

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed request |
| 401 | `UNAUTHENTICATED` / `TOKEN_EXPIRED` | Missing/expired access token |
| 403 | `FORBIDDEN` | Role or ownership failure |
| 404 | `NOT_FOUND` | |
| 409 | `STORE_CLOSED` | Outside operating hours |
| 409 | `ITEM_OUT_OF_STOCK` | Insufficient available stock |
| 409 | `ORDER_IN_PROGRESS` | Idempotent request still executing |
| 409 | `INVALID_STATUS_TRANSITION` | State machine rejection |
| 422 | `OUT_OF_SERVICE_AREA` | Beyond `MAX_SERVICE_RADIUS_KM` |
| 422 | `COD_NOT_ALLOWED` | COD resolution denied |
| 422 | `MIN_ORDER_NOT_MET` | Below minimum |
| 422 | `QTY_LIMIT_EXCEEDED` | Above `max_qty_per_order` |
| 422 | `PRICE_CHANGED` | Client's confirmed total no longer valid |
| 422 | `COUPON_INVALID` / `COUPON_EXPIRED` / `COUPON_LIMIT_REACHED` | |
| 422 | `ADDRESS_LIMIT_REACHED` | > 5 addresses |
| 400 | `OTP_INVALID` / `OTP_EXPIRED` | |
| 429 | `OTP_RATE_LIMITED` / `RATE_LIMITED` | With `Retry-After` |
| 402 | `PAYMENT_FAILED` | |
| 500 | `INTERNAL_ERROR` | Generic; details only in logs |

### 9.4 Endpoint map (V1)

**Public / auth**
```
POST   /api/v1/auth/send-otp
POST   /api/v1/auth/verify-otp
POST   /api/v1/auth/signup                   name + email + password + mobile   (Task 2.6)
POST   /api/v1/auth/login                    email + password, any role         (Task 2.5)
POST   /api/v1/auth/admin/login              email + password, staff roles only
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me                       (auth)
PATCH  /api/v1/auth/me                       (auth) — mobile is not editable
GET    /api/v1/config/public                 app-safe config (radius, currency, flags, min order)
```

> Two ways in, one account. OTP proves the mobile number; email+password does
> not. `UserDto.mobileVerified` reflects which, and the app prompts for an OTP
> login before checkout when it is false — the rider phones that number, and
> COD settlement depends on reaching a real person.

**Store & serviceability**
```
GET    /api/v1/store                         store info + today's hours + open now
GET    /api/v1/store/serviceability?lat=&lng=   → { serviceable, distanceKm, etaMinutes, deliveryFeePaise }
```

**Catalogue** *(public reads; serviceability affects buy-ability, not visibility)*
```
GET    /api/v1/categories?parentId=&depth=
GET    /api/v1/categories/:id/subcategories
GET    /api/v1/products?categoryId=&subcategoryId=&sort=&inStock=&cursor=&limit=
GET    /api/v1/products/:id                  variants + live price + stock
GET    /api/v1/products/search?q=&cursor=
GET    /api/v1/home                          one call: banners + categories + curated rails
```

> `GET /home` is deliberate: the Home screen needs five different collections. On rural 3G, one 250 ms round trip beats five. It is a **read-only composition endpoint** over existing services — not a new domain.

**Cart** *(auth)*
```
GET    /api/v1/cart                          always revalidated; returns changes[]
POST   /api/v1/cart/items                    { variantId, qty }
PATCH  /api/v1/cart/items/:id                { qty }
DELETE /api/v1/cart/items/:id
DELETE /api/v1/cart
POST   /api/v1/cart/coupon                   { code }
DELETE /api/v1/cart/coupon
```

**Addresses** *(auth)*
```
GET    /api/v1/addresses
POST   /api/v1/addresses
PATCH  /api/v1/addresses/:id
DELETE /api/v1/addresses/:id
POST   /api/v1/addresses/:id/default
```

**Checkout & orders** *(auth)*
```
POST   /api/v1/checkout/quote                server-computed bill preview + codAllowed + eta
POST   /api/v1/orders                        [Idempotency-Key]
GET    /api/v1/orders?status=&cursor=
GET    /api/v1/orders/:id
POST   /api/v1/orders/:id/cancel             { reason } — window enforced server-side
GET    /api/v1/orders/:id/receipt            PDF/HTML
```

> `POST /checkout/quote` exists so the Review screen shows the **server's** bill before submitting. It runs the same pricing service as order creation, without side effects. This is what stops the app from ever computing a total.

**Payments** *(auth; webhook is public + signed)*
```
POST   /api/v1/payments/create               [Idempotency-Key] → provider order id
POST   /api/v1/payments/verify               client signal; server re-verifies with provider
POST   /api/v1/payments/webhook              raw body, signature verified, replay-guarded
GET    /api/v1/payments/:orderId/status
```

**Misc** *(auth)*
```
GET    /api/v1/me
PATCH  /api/v1/me
DELETE /api/v1/me                            account deletion
POST   /api/v1/devices                       FCM token register
GET    /api/v1/notifications
POST   /api/v1/products/:variantId/notify-me back-in-stock subscription
```

**Admin** *(auth + role)*
```
GET    /api/v1/admin/dashboard
GET    /api/v1/admin/orders?status=&cursor=
GET    /api/v1/admin/orders/:id
PATCH  /api/v1/admin/orders/:id/status       { toStatus, reason }
POST   /api/v1/admin/orders/:id/assign       { agentId }
POST   /api/v1/admin/orders/:id/refund

CRUD   /api/v1/admin/categories, /products, /products/:id/variants
PATCH  /api/v1/admin/store-variants/:id      price / stock / availability
POST   /api/v1/admin/store-variants/bulk     bulk stock update
POST   /api/v1/admin/uploads/presign         image upload

CRUD   /api/v1/admin/delivery-agents
CRUD   /api/v1/admin/coupons
GET    /api/v1/admin/customers
GET/PATCH /api/v1/admin/config
GET/PATCH /api/v1/admin/store-hours
```

### 9.5 Realtime channels

```
Socket.IO, JWT-authenticated on connect
  room  user:<userId>     order.status_changed, order.eta_updated, payment.status_changed
  room  store:<storeId>   order.created, order.status_changed, stock.low   (admin/staff only)
```
Fallback: both clients poll on a timer when the socket is disconnected (mobile 30 s while a live order exists; admin 20 s always). Realtime is an **optimisation**, never the only path — a dropped socket must not lose an order.

---

## 10. Mobile app architecture

### 10.1 Layering

```
screens/            one file per mockup screen, composition only
  components/       shared design-system components (Task 14.1)
  features/         auth · location · catalog · cart · orders · profile
    <feature>/
      api.ts        typed calls (shared types from packages/types)
      queries.ts    TanStack Query hooks (keys, staleness, retry policy)
      store.ts      Zustand slice — client state only
      components/
  lib/              apiClient (interceptors), storage, i18n, analytics, formatters
  navigation/       RootNavigator, AuthStack, MainTabs, per-tab stacks
  theme/            tokens: colors, spacing, radius, typography
```

### 10.2 State ownership (the rule that prevents a mess)

| Kind of state | Owner | Examples |
|---|---|---|
| Server state | **TanStack Query** | products, categories, cart, orders, addresses, config |
| Client state | **Zustand** | auth tokens, selected address, language, onboarding seen |
| Ephemeral UI | `useState` | modal open, form fields |
| Secrets | **expo-secure-store** (Keychain/Keystore) | refresh token |

**The cart is server state.** It lives on the server; the app renders whatever `GET /cart` returns. Optimistic updates on the quantity stepper for responsiveness, reconciled against the server response — but the server's number always wins. This is the "never trust client totals" rule expressed in the client architecture.

### 10.3 Navigation

```
RootNavigator
├── AuthStack           Splash · Mobile · OTP
├── LocationStack       Permission · DetectLocation · OutOfServiceArea
└── MainTabs            Home · Categories · Search · Cart(badge) · Account
    ├── HomeStack       Home → ProductList → ProductDetail → …
    ├── CategoriesStack Categories → CategoryListing → ProductDetail
    ├── SearchStack     Search → Results → ProductDetail
    ├── CartStack       Cart → Checkout(4 steps) → OrderPlaced → Tracking
    └── AccountStack    Account → PersonalInfo · Addresses · Orders → OrderDetail
                                → ReferEarn · About · Help · Legal
```
A live order surfaces a persistent bottom banner ("Arriving in 12 mins →") above the tab bar, from any tab — that, plus Orders inside Account, is why Cart takes the fifth tab slot (§2.1 C12).

### 10.4 Networking behaviour (this market's defining constraint)

- **Timeouts:** 15 s default, 30 s for order placement.
- **Retries:** GETs retry twice with exponential backoff + jitter. **Mutations never auto-retry** — except via an explicit user action carrying the same `Idempotency-Key`.
- **Token refresh:** a single-flight interceptor; concurrent 401s wait on one refresh, never stampede.
- **Offline:** last catalogue/cart response cached (AsyncStorage-persisted Query cache) so the app opens to content, marked stale. Checkout is blocked offline with a clear message.
- **Duplicate submission:** the Place Order button disables on tap, an `Idempotency-Key` is generated per checkout attempt and reused across retries of that attempt.

### 10.5 Low-end Android performance

Hermes engine on; `FlatList` with `getItemLayout` and fixed row heights for the product grid; **WebP** images served in three renditions (`thumb` 200 px for rails, `card` 400 px for grids, `detail` 800 px) chosen by the component, never full-size; `expo-image` with memory+disk cache and blurhash placeholders; no reanimated-heavy transitions; APK target < 25 MB; measured on a 2 GB-RAM device, not a simulator.

### 10.6 Language

`i18next` from Task 14.1 — **all strings extracted from day one**, `en` complete, `hi` filled in during Phase 14. Retrofitting i18n after 16 screens is a week of tedious work; doing it upfront costs an hour. Product names carry `name_hi`, with fallback to `name`. Numerals stay Western Arabic (₹249, not २४९) — that is what this market reads on packaging.

---

## 11. Admin web architecture

```
src/
  app/            router, providers, auth guard
  features/
    dashboard/ orders/ catalog/ inventory/ delivery/ customers/ config/
  components/     Table, Drawer, StatusPill, Money, ConfirmDialog, ImageUploader
  lib/            apiClient, socket, queryClient, formatters
```

- React 18 + Vite + TypeScript, TanStack Query for all server state, React Router, Tailwind + a small component set.
- **Auth:** email + password for admins (see §20 O4), access token in memory + refresh token in an httpOnly cookie. Admin sessions are not stored in `localStorage`.
- **Realtime:** subscribes to `store:<id>`; new orders animate in with an **audible chime that repeats until acknowledged**, plus a 20 s poll fallback.
- **Responsive:** designed for a counter tablet in landscape first (that is where it will actually live), then desktop. The order-accept flow must work on touch.
- **Print:** a CSS print stylesheet renders a thermal-printer-friendly pick slip.
- **Optimistic edits** on stock/price with rollback on error, because staff edit rapidly.

---

## 12. Project folder structure

**Three independent projects, three separate folders.** Each has its own
`package.json`, its own `node_modules` and its own build. There is no monorepo
tooling, no npm workspaces and no cross-project linking — any one project can
be cloned, installed and run on its own.

```
adione/
├── docker-compose.yml            postgres + redis + minio (optional local infra)
├── docker-compose.prod.yml
├── .gitignore
├── README.md
├── PROGRESS.md
├── AdiOne_ClaudeCode_TaskList.md
├── docs/
│   ├── 01-PRD-and-Architecture.md      ← this file
│   ├── 02-decisions.md
│   ├── 03-database-schema.md
│   ├── 04-api-reference.md
│   ├── 05-business-rules.md
│   ├── 06-deployment.md
│   └── 07-admin-guide.md
│
├── backend/                      Node.js · Express 5 · TypeScript · Prisma
│   ├── package.json  tsconfig.json  .env.example
│   ├── scripts/sync-shared.mjs   mirrors src/shared into web/ and mobile/
│   ├── prisma/{schema.prisma, migrations/, seed/}
│   ├── src/
│   │   ├── shared/               ★ CANONICAL SHARED CONTRACT
│   │   │   enums · order-state-machine · errors · api · permissions
│   │   │   config-keys · dto · money · distance · phone · datetime
│   │   │   cod · text · theme
│   │   ├── config/               env loader (fail-fast), constants
│   │   ├── common/               AppError · logger · request-context · response · pagination
│   │   ├── middleware/           auth · rbac · rateLimit · idempotency · errorHandler · requestLogger
│   │   ├── modules/              ← the module boundary
│   │   │   ├── auth/             controller · service · repository · routes · validation
│   │   │   ├── users/  addresses/  stores/  catalog/  inventory/
│   │   │   ├── cart/  orders/  payments/  delivery/  notifications/
│   │   │   ├── configuration/  search/  admin/
│   │   │   └── health/
│   │   ├── infra/                provider implementations behind ports
│   │   │   ├── db/               Prisma client + transaction helpers
│   │   │   ├── cache/            {memory,redis}
│   │   │   ├── payment/          {mock,razorpay}
│   │   │   ├── otp/              {console,msg91}
│   │   │   ├── notification/     {console,fcm}
│   │   │   ├── storage/          {local,s3}
│   │   │   └── search/           {postgres}
│   │   ├── jobs/                 releaseReservations · retryNotifications · reconcilePayments
│   │   ├── realtime/             socket server + rooms
│   │   ├── app.ts  server.ts
│   └── tests/{integration,e2e,helpers}
│
├── web/                          React 18 · Vite · TypeScript  (§11)
│   ├── package.json  vite.config.ts  tsconfig.json
│   └── src/
│       ├── shared/               ⟵ generated copy, do not edit
│       ├── app/  features/  components/  lib/
│
└── mobile/                       React Native (Expo) · TypeScript  (§10)
    ├── package.json  app.json  tsconfig.json
    └── src/
        ├── shared/               ⟵ generated copy, do not edit
        ├── screens/  features/  components/  navigation/  lib/  theme/
```

### 12.1 How the shared contract works without a monorepo

The order status enum, error codes, every DTO, the COD resolver and
`calculateDistance` must mean the same thing in all three projects. With
separate folders there is no linked package to import, so the contract is
**defined once and mirrored**:

```
backend/src/shared/     canonical — edit here
        │
        └── npm run sync:shared ──►  web/src/shared/     generated copy
                                └─►  mobile/src/shared/  generated copy
```

- Every generated file carries a `GENERATED — DO NOT EDIT` banner.
- Copies are **committed**, so a fresh clone of `web/` or `mobile/` builds
  without touching the backend.
- CI runs `npm run sync:shared -- --check`, which fails the build if any copy
  has drifted.
- Everything in `shared/` is dependency-free and platform-neutral — no Node
  built-ins, no Prisma, no Express, no React — so the identical file runs under
  Node, in a browser and under Hermes.

**The trade-off, stated plainly.** A linked workspace package makes drift
impossible at build time; copying makes drift possible if someone skips the
sync. We accept that in exchange for three genuinely independent projects
(independent installs, independent CI, independent deploys, no Metro
`watchFolders` configuration, no hoisting problems in React Native), and we
mitigate it with the committed copies plus the `--check` gate. The mirrored
surface is small and changes rarely once Phase 1 is done.

**Backend module rule:** each folder under `modules/` owns its tables and
exposes a service interface. Cross-module access goes through that interface,
never into another module's repository. That is the seam that would let
`search` or `notifications` be extracted into a separate process later without
redesign (§18.2).

---

## 13. Security architecture

### 13.1 Threat model (what actually gets attacked here)

| Threat | Realistic? | Control |
|---|---|---|
| OTP brute force / SMS-bombing a number | **Very** | Multi-layer rate limits (§13.3), 5 attempts per OTP, 30 s resend cooldown, hashed OTP storage |
| Price/total tampering by a modified client | **Very** | Server computes every rupee; client-sent prices are **not accepted as input fields at all** |
| Ordering out-of-stock / inactive items | Yes | Locked re-validation inside the order transaction |
| COD abuse (fake orders, cash loss) | **Very** | Order-value cap, phone verified, first-order COD limit (config), block-list, admin reject |
| Duplicate charge / duplicate order | Yes | Idempotency keys + unique `(provider, provider_payment_id)` |
| Forged payment success | Yes | Server-side verification + signed webhook as authority; client "success" is only a hint |
| IDOR (reading another user's order/address) | Yes | Ownership check in every service, never only in the route |
| Admin panel compromise | Yes | Separate role, strong password policy, optional TOTP, session revocation, audit log |
| PII leakage (mobile numbers, addresses) | Yes | No PII in logs, field-level redaction in the logger, HTTPS only, least-privilege DB user |
| Webhook replay | Yes | `payment_events.event_id` unique + signature + timestamp window |
| SQL injection | Low (Prisma) | Parameterised everywhere; raw SQL only via tagged templates |

### 13.2 Authentication

- **OTP:** 6 digits, cryptographically random. Stored in Redis as `HMAC-SHA256(otp, server_pepper)` keyed by mobile, TTL 5 min, with an attempt counter. **The plaintext OTP is never persisted or logged** (a stub provider prints it to console in dev only, gated on `NODE_ENV !== 'production'`).
- **Access token:** JWT, 15 min, `HS256` (single service — asymmetric buys nothing yet), claims `sub`, `role`, `sid`, `iat`, `exp`.
- **Refresh token:** 256-bit opaque random, stored **hashed** in `refresh_tokens` with a `family_id`. Rotated on every use. **Reuse detection:** presenting an already-rotated token revokes the entire family and forces re-login — this is the standard defence against a stolen refresh token.
- **Storage:** mobile → `expo-secure-store` (Keychain / Android Keystore), never AsyncStorage. Admin → refresh in httpOnly+Secure+SameSite cookie, access in memory.
- **Logout:** revokes the token family server-side. Logout is not just clearing local storage.

### 13.3 Rate limiting (Redis token buckets)

| Scope | Limit |
|---|---|
| `send-otp` per mobile | 3 / hour, 10 / day |
| `send-otp` per IP | 10 / hour |
| `verify-otp` per mobile | 5 attempts per OTP, then invalidate |
| `POST /orders` per user | 10 / hour |
| Authenticated API per user | 300 / min |
| Unauthenticated API per IP | 60 / min |
| Admin API per user | 600 / min |

Responses carry `Retry-After` and `X-RateLimit-*`. Limits are configuration, not constants.

### 13.4 Authorization

Roles in V1: `CUSTOMER`, `ADMIN`, `STORE_OWNER`. Future: `SUPER_ADMIN`, `STORE_MANAGER`, `DELIVERY_AGENT`, `STAFF`, `PHARMACIST`, `RESTAURANT_MANAGER`.

Implementation: `role → permission[]` map in `packages/types`, `requirePermission('order:update_status')` middleware. Adding a role is a map entry, not a code change. **Ownership is checked separately and always in the service layer** — `requireRole` alone never protects a resource.

### 13.5 Transport, headers, and secrets

- HTTPS everywhere; HSTS; TLS terminated at the proxy.
- `helmet` for security headers; CORS allow-list (admin origin + mobile has no Origin) — never `*` with credentials.
- Body size limits; **raw body preserved only on the webhook route** for signature verification.
- Secrets **only** from environment. `.env` git-ignored, `.env.example` documents every key with a dummy value. Fail-fast validation of env at boot (§ Task 0.3) — the process refuses to start with a missing `JWT_SECRET` rather than running insecurely.
- The mobile app ships **no secrets**. It holds only the API base URL and the PSP's public key.
- Least-privilege Postgres role for the app (no `SUPERUSER`, no `CREATE`).

### 13.6 Logging & privacy

Structured JSON (pino) with `requestId`, `userId`, route, latency, status. A redaction list strips `otp`, `token`, `authorization`, `password`, `signature`, and masks `mobile` to `9876****10`. Full request bodies are never logged on auth or payment routes. Log retention 30 days. Sentry hook exists, disabled until a DSN is configured.

---

## 14. Payment architecture

### 14.1 The port

```ts
interface PaymentProvider {
  createPaymentIntent(input: { orderId; amountPaise; currency; customer }): Promise<{ providerOrderId; publicKey; ... }>
  verifyPayment(input: { providerOrderId; providerPaymentId; signature }): Promise<PaymentVerification>
  parseWebhook(rawBody: Buffer, headers): Promise<{ eventId; type; payload; signatureValid: boolean }>
  refund(input: { providerPaymentId; amountPaise; reason }): Promise<RefundResult>
  getPaymentStatus(providerPaymentId): Promise<PaymentStatus>
}
```
Implementations: `RazorpayProvider` (or Cashfree) and `MockProvider` for dev/tests. **No provider SDK is imported outside `infra/payment/<provider>/`.** Swapping PSPs is one class plus config.

### 14.2 Clarification: UPI / PhonePe / GPay / Paytm / Card are not five integrations

The mockup's payment list is the **PSP's checkout sheet**, not five gateways. One integration with Razorpay or Cashfree gives UPI intent (which launches PhonePe/GPay/Paytm), UPI collect, cards, netbanking and wallets. Building direct integrations with each wallet would multiply KYC, reconciliation and failure surface for zero customer benefit. V1 = **one PSP + COD**, and the app renders whichever methods the PSP reports as enabled.

### 14.3 Money handling

Integer paise end to end. The PSP is called in paise. The order total computed at creation is the **only** amount ever charged; the client never sends an amount. Verification compares the provider's captured amount to `orders.total_paise` and treats a mismatch as fraud (log, alert, do not confirm).

### 14.4 Online payment flow (and why both verify and webhook exist)

```
1  POST /orders            → order PENDING_PAYMENT, stock RESERVED, reservation expiry set
2  POST /payments/create   → provider order; payments row CREATED     [Idempotency-Key]
3  app opens PSP sheet → user pays in their UPI app
4a FAST PATH   app → POST /payments/verify {providerPaymentId, signature}
                server verifies signature AND re-queries the provider API
                → transaction: payment CAPTURED, reservation committed to stock,
                  order PAYMENT_CONFIRMED → ORDER_PLACED, notify
4b TRUTH PATH  provider → POST /payments/webhook (signed, raw body)
                verify signature → dedupe on event_id → same transactional handler
5  RECONCILE   job sweeps payments stuck PENDING > 15 min and asks the provider directly
```

Three paths converge on **one idempotent handler**. Whichever arrives first wins; the others are no-ops. This is the design that survives the real failure modes: the app is killed mid-payment, the webhook arrives before the app returns, the phone loses network after paying, or the provider retries a webhook five times.

**A client-reported success alone never confirms a payment.** `/payments/verify` re-queries the provider server-side; the signature is checked against the server's own secret.

### 14.5 Failure, expiry, and refunds

| Situation | Handling |
|---|---|
| Payment fails / user abandons | Order stays `PENDING_PAYMENT`. App offers Retry (same order, same reservation) or Cancel. |
| No payment within `PAYMENT_HOLD_MINUTES` (10) | Job → `PAYMENT_FAILED`, reservation released, stock free again, customer notified. |
| Paid but order rejected by store | Auto-refund full amount → `REFUNDED`. |
| Customer cancels a prepaid order in the allowed window | Auto-refund full amount. |
| Item removed by store before ready (M1) | Partial refund of the line total. |
| Refund fails at the PSP | Refund row `FAILED`, admin alerted, retried by job, manual path documented. |
| Duplicate payment for one order | Second capture detected by unique `(provider, provider_payment_id)`; auto-refund + alert. |

**COD** creates the order directly in `ORDER_PLACED` (no `PENDING_PAYMENT`), with `payment_status = PENDING`, moving to `PAID` when the rider marks delivery with cash collected.

---

## 15. Location, serviceability & ETA architecture

### 15.1 The three reusable functions (`packages/utils` + server services)

```ts
calculateDistance(lat1, lng1, lat2, lng2): number            // km, Haversine
checkServiceability(userLat, userLng, storeLat, storeLng): { serviceable: boolean; distanceKm: number }
estimateDeliveryTime(input): { etaMinutes: number; etaMinMinutes: number; etaMaxMinutes: number }
```

`MAX_SERVICE_RADIUS_KM` is read from Configuration on every evaluation. The literal `10` appears **exactly once in the entire codebase**: as a seed value in the configuration seed script.

### 15.2 Serviceability rules

- Serviceability uses **straight-line Haversine** distance. This matches the customer-facing promise ("we deliver up to 10 km from our store") and is stable, cheap, and requires no external API.
- **The road/travel distance is longer** — typically 1.2–1.4× straight line. That factor is applied to **ETA and delivery fee**, not to the serviceability boundary, via `ROAD_DISTANCE_FACTOR` (default 1.3). Conflating the two is a classic bug: a customer 9.8 km straight-line is serviceable, but is a ~13 km ride and must be priced and promised as such.
- Serviceability is checked at **four** points, always server-side: app open, address save, address select at checkout, and order creation. The client's answer is never trusted; the client only *displays* it.
- Result cached per address (`addresses.is_serviceable`, `distance_km`) and invalidated when the store location or radius changes.

### 15.3 ETA formula (V1)

```
roadKm         = haversineKm × ROAD_DISTANCE_FACTOR
travelMinutes  = (roadKm / AVG_DELIVERY_SPEED_KMPH) × 60
prepMinutes    = BASE_PREPARATION_MINUTES + (itemCount × PER_ITEM_PICK_SECONDS / 60)
loadMinutes    = ceil(activeOrders / ORDERS_PER_RIDER_BATCH) × BATCH_DELAY_MINUTES
eta            = prepMinutes + travelMinutes + loadMinutes + ETA_BUFFER_MINUTES
display        = round to nearest 5, shown as a range [eta − 5, eta + 5]
```

Worked example matching the mockup (3.2 km, 2 items, quiet store):
`roadKm 4.2 → travel 10 min (25 km/h) + prep 10 + load 0 + buffer 3 = 23 → "20–25 mins"`.

Every capitalised term is a Configuration key. The ETA is stored on the order (`eta_minutes`, `promised_at`) at placement so the promise is auditable, and is recomputed on `OUT_FOR_DELIVERY`. Later versions can swap in a routing API behind the same function.

### 15.4 Address capture UX (small-town reality)

GPS in villages is often accurate to only 20–50 m, and formal addresses frequently don't exist — "Near Shiv Mandir, Main Road" *is* the address, exactly as the mockup shows. Therefore:
- Reverse-geocode to prefill, but **always let the user drag the pin** and edit every field.
- **Landmark is a first-class, prominent field**, not an afterthought — it is what the rider actually navigates by.
- Store both the human-readable address and lat/lng; lat/lng is authoritative for distance, text is authoritative for the rider.
- Geocoding provider (Google/Ola/MapMyIndia) sits behind a `GeocodingProvider` port; V1 can ship with manual entry only if a key isn't available on day one, without changing the schema.

---

## 16. Order lifecycle

### 16.1 States

| State | Meaning | Terminal |
|---|---|---|
| `PENDING_PAYMENT` | Created, awaiting online payment; stock reserved | no |
| `PAYMENT_CONFIRMED` | Payment verified server-side | no |
| `ORDER_PLACED` | Visible to the store, awaiting acceptance | no |
| `STORE_ACCEPTED` | Store accepted ("Order Confirmed" to the customer) | no |
| `PREPARING` | Being picked/packed | no |
| `READY_FOR_PICKUP` | Packed, awaiting rider | no |
| `OUT_FOR_DELIVERY` | Rider en route | no |
| `DELIVERED` | Completed | **yes** |
| `CANCELLED` | Cancelled by customer or admin | **yes** |
| `PAYMENT_FAILED` | Payment failed or hold expired | **yes** |
| `REJECTED` | Store declined | **yes** |
| `REFUNDED` | Money returned | **yes** |

### 16.2 Transition table (the state machine)

| From | Allowed → | Actor | Side effects |
|---|---|---|---|
| `PENDING_PAYMENT` | `PAYMENT_CONFIRMED` | SYSTEM (verify/webhook) | commit reservation → stock |
| `PENDING_PAYMENT` | `PAYMENT_FAILED` | SYSTEM (job/webhook) | release reservation, notify |
| `PENDING_PAYMENT` | `CANCELLED` | CUSTOMER | release reservation |
| `PAYMENT_CONFIRMED` | `ORDER_PLACED` | SYSTEM (auto) | notify store (socket + chime), notify customer |
| `ORDER_PLACED` | `STORE_ACCEPTED` | ADMIN | notify "Order confirmed" |
| `ORDER_PLACED` | `REJECTED` | ADMIN | release stock, auto-refund if prepaid, notify |
| `ORDER_PLACED` | `CANCELLED` | CUSTOMER / ADMIN | release stock, refund if prepaid |
| `STORE_ACCEPTED` | `PREPARING` | ADMIN | notify |
| `STORE_ACCEPTED` | `CANCELLED` | ADMIN (+ CUSTOMER if within window) | release stock, refund |
| `PREPARING` | `READY_FOR_PICKUP` | ADMIN | notify "Order packed" |
| `PREPARING` | `CANCELLED` | ADMIN | release stock, refund |
| `READY_FOR_PICKUP` | `OUT_FOR_DELIVERY` | ADMIN (requires an assigned agent) | notify, recompute ETA |
| `READY_FOR_PICKUP` | `CANCELLED` | ADMIN | release stock, refund |
| `OUT_FOR_DELIVERY` | `DELIVERED` | ADMIN/AGENT (delivery OTP for COD) | COD → payment PAID + cash recorded; notify |
| `OUT_FOR_DELIVERY` | `CANCELLED` | ADMIN only (exception path, reason required) | manual stock decision, refund |
| `CANCELLED` / `REJECTED` | `REFUNDED` | SYSTEM | on refund success |
| any terminal | — | — | rejected with `INVALID_STATUS_TRANSITION` |

COD orders skip `PENDING_PAYMENT` / `PAYMENT_CONFIRMED` and are created directly in `ORDER_PLACED`.

Implementation: a single `ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]>` map plus a `transitionOrder()` service that is **the only** code permitted to write `orders.status`. It locks the order row, validates the transition, writes `order_status_history`, and enqueues notifications post-commit. No other module ever assigns a status.

### 16.3 Cancellation policy

- Customer may cancel until `CANCELLATION_ALLOWED_UNTIL` (config; default `PREPARING` — i.e. up to and including `STORE_ACCEPTED`). Beyond that the app shows "Call the store to cancel".
- Admin may cancel until `OUT_FOR_DELIVERY`, with a required reason.
- Prepaid cancellations auto-initiate a full refund.
- Every cancellation records `cancelled_by` and `cancellation_reason`.

### 16.4 Deviation D5 — customer-facing timeline mapping

The mockup's tracking screen shows 5 steps; internally we have 12 states. One mapping table, used by both clients:

| Customer step (mockup) | Internal states |
|---|---|
| Order Placed | `ORDER_PLACED`, `PAYMENT_CONFIRMED` |
| Order Confirmed | `STORE_ACCEPTED` |
| Order Packed | `PREPARING`, `READY_FOR_PICKUP` |
| Out for Delivery | `OUT_FOR_DELIVERY` |
| Delivered | `DELIVERED` |
| *(exception banner)* | `CANCELLED`, `REJECTED`, `PAYMENT_FAILED`, `REFUNDED`, `PENDING_PAYMENT` |

The API returns both the raw `status` and a `timeline[]` already mapped, so **no client ever switches on a raw status string** — which is the spec's "do not scatter random status strings" rule applied to the frontend as well as the backend.

---

## 17. Business rules reference

*(This section becomes `docs/04-business-rules.md` at Task 17.3.)*

### 17.1 Configuration keys (V1)

| Key | Default | Used by |
|---|---|---|
| `MAX_SERVICE_RADIUS_KM` | 10 | serviceability |
| `STORE_LATITUDE` / `STORE_LONGITUDE` | seed | serviceability, ETA |
| `STORE_TIMEZONE` | `Asia/Kolkata` | hours |
| `MIN_ORDER_VALUE_PAISE` | 9900 | cart, checkout |
| `DELIVERY_FEE_SLABS` | `[{maxKm:3,fee:2000},{maxKm:6,fee:3000},{maxKm:10,fee:4000}]` | pricing |
| `FREE_DELIVERY_THRESHOLD_PAISE` | 29900 | pricing |
| `PLATFORM_FEE_PAISE` | 500 | pricing |
| `STORE_OPEN_TIME` / `STORE_CLOSE_TIME` | 08:00 / 22:00 | store open |
| `ALLOW_ORDERS_WHEN_CLOSED` | false | checkout gate |
| `DEFAULT_COD_POLICY` | `ALLOW` | COD resolution |
| `COD_MAX_ORDER_VALUE_PAISE` | 300000 | COD resolution |
| `COD_FIRST_ORDER_MAX_PAISE` | 100000 | COD resolution |
| `BASE_PREPARATION_MINUTES` | 10 | ETA |
| `PER_ITEM_PICK_SECONDS` | 20 | ETA |
| `AVG_DELIVERY_SPEED_KMPH` | 25 | ETA |
| `ROAD_DISTANCE_FACTOR` | 1.3 | ETA, fee |
| `ORDERS_PER_RIDER_BATCH` / `BATCH_DELAY_MINUTES` | 3 / 8 | ETA |
| `ETA_BUFFER_MINUTES` | 3 | ETA |
| `PAYMENT_HOLD_MINUTES` | 10 | reservation release |
| `CANCELLATION_ALLOWED_UNTIL` | `PREPARING` | cancellation |
| `MAX_ADDRESSES_PER_USER` | 5 | addresses |
| `DEFAULT_MAX_QTY_PER_ORDER` | 10 | cart, checkout |
| `LOW_STOCK_THRESHOLD` | 5 | dashboard |
| `DELIVERY_OTP_REQUIRED_FOR_COD` | true | delivery |
| `FEATURE_REFERRAL_ENABLED` | false | app |
| `FEATURE_COUPONS_ENABLED` | true | app |
| `SUPPORT_PHONE` / `SUPPORT_WHATSAPP` | seed | app |

No business number appears anywhere in code except in the seed for this table.

### 17.2 Pricing & tax (order of operations — fixed)

```
1  line_total      = unit_price_paise × qty                       (unit price is tax-INCLUSIVE)
2  items_subtotal  = Σ line_total
3  item_discount   = Σ (mrp − unit_price) × qty                   (displayed as savings)
4  coupon_discount = coupon applied to items_subtotal, capped by max_discount_paise
5  delivery_fee    = slab(distanceKm × ROAD_DISTANCE_FACTOR)
                     → 0 if (items_subtotal − coupon_discount) ≥ FREE_DELIVERY_THRESHOLD
                     → 0 if coupon type = FREE_DELIVERY
6  platform_fee    = PLATFORM_FEE_PAISE  (line hidden when 0)
7  tax_component   = Σ line_total × rate/(10000 + rate)           EXTRACTED, not added
8  total           = items_subtotal − coupon_discount + delivery_fee + platform_fee
```

Rounding: every intermediate stays an integer in paise; rounding is half-up at the single point where a percentage is applied. `total_paise` is computed once at order creation and stored. The client re-renders it; the client never derives it.

### 17.3 COD eligibility (precedence, fully data-driven)

`allow_cod` is a **three-state** enum — `ALLOW` | `DENY` | `INHERIT` — present on `store_variants`, `product_variants`, `products`, `categories` (every level of the tree) and `stores`.

**Per line item**, resolve by walking outward and taking the **first non-`INHERIT`** value:

```
store_variant → product_variant → product → category(leaf) → category(parent…root) → store → DEFAULT_COD_POLICY
```

**Per order**, COD is allowed only if **all** hold (most restrictive wins):

```
1  every line item resolves to ALLOW
2  store.allow_cod resolves to ALLOW
3  order_total ≤ COD_MAX_ORDER_VALUE_PAISE
4  if this is the customer's first delivered order:
       order_total ≤ COD_FIRST_ORDER_MAX_PAISE
5  customer is not COD-blocked (users.status / cod_blocked flag)
```

A single `DENY` anywhere disables COD for the entire order. The UI shows COD disabled **with the reason and the offending item named** — never silently hidden. The resolved value is snapshotted per line into `order_items.allow_cod_resolved`, so any dispute is auditable.

"Fresh vegetables are not COD" is then expressed as: set the Vegetables category's `allow_cod = DENY`. **Zero code changes, zero category names in code.**

### 17.4 Coupons (V1, minimal)

One code per order, non-stacking. Types: `PERCENT` (with `max_discount_paise`), `FLAT`, `FREE_DELIVERY`. Validated at cart, **re-validated inside the order transaction** (validity window, min order, total usage, per-user usage). Redemption row written in the same transaction — the usage limit cannot be raced. Free-delivery threshold applies independently of coupons.

### 17.5 Store hours

Open if: today's `store_hours` row is not `is_closed`, now (in `stores.timezone`) is within `[opens_at, closes_at)`, and no `store_closures` row matches today. Closed → browsing and cart allowed, order placement returns `STORE_CLOSED` unless `ALLOW_ORDERS_WHEN_CLOSED`. Overnight hours (e.g. 08:00–01:00) are handled by the comparison, not assumed away.

---

## 18. Scalability strategy (V1 → V6)

### 18.1 What each version adds, and what it must NOT require

| Version | Adds | Cost, given this architecture |
|---|---|---|
| **V1** | Grocery, 1 store, 10 km | — |
| **V2** | Vegetables & fruits (weight-based) | New `vertical`, seed categories, `allow_cod = DENY` on the category. Weight-based pricing = a `unit`/`unit_value` already on the variant + a "sold by weight" attribute and a ±10% weight-tolerance rule at delivery. **No core order/payment change.** |
| **V3** | Café / fast food | `vertical = CAFE`; add-ons are a new `variant_options` table (options + choices) referenced from `order_items.options` JSONB; per-product prep time already feeds the existing ETA function. **No change to cart, payment, or state machine.** |
| **V4** | Pharmacy | `products.attributes.prescription_required`; a `prescriptions` table + upload + an approval step **inserted as a state-machine transition** (`ORDER_PLACED → PENDING_PRESCRIPTION_APPROVAL → STORE_ACCEPTED`). The transition map is data — this is why the state machine is centralised. |
| **V5** | Clothing | Size/colour are just variants with a `variant_attributes` JSONB. Variant-level images and inventory already exist. |
| **V6** | Multi-store, rider app, auto-assignment | Every table is already `store_id`-scoped. Adds: store-selection by nearest serviceable store, per-store catalogue admin, rider auth (`DELIVERY_AGENT` role — the RBAC map already anticipates it) against the contract designed in Task 10.2, and an assignment algorithm behind the existing manual-assignment interface. |

**The commitment:** none of V2–V6 requires changing `orders`, `order_items`, `payments`, the state machine, or the pricing pipeline. That is the concrete meaning of "no rewrite between stages", and it is the criterion every schema decision in §8 was tested against.

### 18.2 Technical scaling path (only when metrics demand it)

| Load | Action |
|---|---|
| ≤ 500 orders/day | Current topology. One process, one DB. Nothing to do. |
| ~2,000 orders/day | Add Redis caching for catalogue reads; add DB read replica for listings; enable Socket.IO Redis adapter; run 2 API processes behind the proxy. |
| ~10,000 orders/day | Extract the notification worker to its own process with a real queue (BullMQ); move search to Meilisearch behind the existing `SearchProvider`; CDN for all images. |
| Multi-city | Partition by `store_id`; consider per-region deployments; only now consider extracting services. |

Everything above the first row is deferred **on purpose**. The seams (ports, module boundaries, store scoping) exist so these are configuration and extraction, not redesign.

---

## 19. Development roadmap & complexity estimate

### 19.1 Sequenced roadmap

| Stage | Phases | Outcome |
|---|---|---|
| **Foundation** | 0–1 | Monorepo, API skeleton, schema, config, seed data |
| **Core backend** | 2–8 | Auth, serviceability, catalogue, inventory, cart, addresses, orders — a complete purchasable backend |
| **Money & ops** | 9–12 | Payments, delivery, notifications, realtime |
| **Store panel** | 13 | The owner can run the business (this is the true launch gate — the app is useless without it) |
| **Customer app** | 14 | All 16 mockup screens |
| **Integration** | 15 | Real APIs everywhere, network hardening |
| **Testing** | 16 | Unit, integration, E2E, concurrency |
| **Production** | 17 | Docker, envs, deploy, docs |

### 19.2 Complexity estimate (one experienced full-stack developer, focused)

| Phase | Days | Complexity | Note |
|---|---:|---|---|
| 0 — Architecture & skeleton | 3 | Low | This doc + scaffolding |
| 1 — DB & config | 5 | **High** | The schema is the foundation; mistakes here are expensive |
| 2 — Auth | 4 | Medium | OTP + rotation + rate limits |
| 3 — Serviceability | 2 | Low | Pure functions + config |
| 4 — Catalogue | 6 | Medium | Search + admin CRUD + images |
| 5 — Inventory | 3 | Medium | Ledger + reservation primitive |
| 6 — Cart | 3 | Medium | Revalidation is subtler than it looks |
| 7 — Addresses | 2 | Low | |
| 8 — Orders & checkout | 8 | **Very high** | Transaction, locking, idempotency, COD, ETA. **The riskiest phase.** |
| 9 — Payments | 5 | **Very high** | Three convergent paths, webhooks, refunds |
| 10 — Delivery | 3 | Low | |
| 11 — Notifications | 2 | Low | |
| 12 — Realtime | 2 | Medium | |
| 13 — Admin panel | 12 | Medium | Six screens, but they must be genuinely usable |
| 14 — Mobile app | 25 | **High** | 16 screens + design system + offline behaviour |
| 15 — Integration | 5 | Medium | |
| 16 — Testing | 8 | **High** | Concurrency and payment tests are real work |
| 17 — Production | 5 | Medium | |
| | **≈ 103 dev-days** | | ≈ **21 weeks solo**, ≈ **10–12 weeks** with one backend + one mobile developer working in parallel from Phase 4 |

Add ~15% for review cycles and mockup-fidelity iteration. **Honest headline: ~5 months solo, ~3 months for a pair.** Anyone quoting 3 weeks for this scope is quoting a demo.

### 19.3 External lead times — start these on day 1, they block launch

| Item | Lead time | Blocks |
|---|---|---|
| **DLT registration** (TRAI) for SMS sender ID + OTP template | **3–10 working days**, often longer | All OTP login. **This is the single most under-estimated launch blocker in Indian app projects.** |
| Payment gateway KYC (business proof, bank account, GSTIN if applicable) | 3–7 days | Online payments |
| Google Play developer account + first app review | 1–2 weeks (new accounts also need closed testing) | Distribution |
| Domain + SSL | Hours | Everything |
| Privacy policy & T&C content | Owner-dependent | Play Store submission |
| Product catalogue data + photography | **Owner-dependent, often the real bottleneck** | A usable launch |

A viable de-risking path: pilot with COD-only + WhatsApp-based OTP fallback while DLT and PSP KYC complete.

---

## 20. Critical risks, mitigations & open decisions

### 20.1 Risk register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R1 | **Overselling** under concurrent checkout | Customer paid for stock that doesn't exist; manual refund + reputation damage | High without controls | `SELECT … FOR UPDATE` on `store_variants` in deterministic `variant_id` order inside the order transaction; `reserved_qty`; DB `CHECK` constraints as a last line; **a real concurrency test firing N simultaneous checkouts for the last unit** (Task 16.1) |
| R2 | **Payment / order desync** — money taken, order not placed (or vice versa) | Direct financial loss and total trust loss | High without controls | Webhook as source of truth + client verify as fast path + reconciliation job; all three through one idempotent handler; unique `(provider, provider_payment_id)`; amount cross-check against `orders.total_paise` |
| R3 | **Duplicate orders** on flaky networks | Double delivery, double charge | High | `Idempotency-Key` + unique `(user_id, idempotency_key)`; button disabled on tap; key reused across retries of one attempt |
| R4 | **GPS inaccuracy / no formal addresses** | Failed deliveries, angry riders | High in this market | Draggable pin, mandatory prominent landmark, customer phone on every order, rider calls; `ROAD_DISTANCE_FACTOR` for honest ETAs |
| R5 | **DLT/SMS approval delay** blocks login | Cannot launch | **Medium-high** | Start registration day 1; `OtpProvider` port allows swapping providers or a WhatsApp fallback in hours; stub provider for all dev/testing |
| R6 | **COD fraud / cash leakage** | Direct loss | Medium | Order-value caps (global + first-order), verified phone, delivery OTP, per-agent cash reconciliation, block-list, admin reject with reason |
| R7 | **Store staff don't adopt the panel** | The whole system stalls at the counter — orders time out | **Medium-high, and routinely ignored** | 2-click accept; repeating audible chime; large touch targets; tablet-landscape-first; printable pick slip; poll fallback so a dropped socket never loses an order; on-site training + a one-page guide (Task 17.3) |
| R8 | **Inventory drift** (system says 12, shelf has 3) | Oversells despite correct code | High in real retail | `stock_ledger` for every movement; low-stock dashboard; daily reconciliation screen; make "mark out of stock" a one-tap action from the order screen |
| R9 | **Unrealistic delivery promise** (the 10-minute copy) | Systematic broken promises | High if shipped as-is | §2.1 C1 — computed ETA everywhere, honest marketing band |
| R10 | **Low-end device performance** | App abandoned on the target device class | Medium | Hermes, virtualised lists, WebP renditions, < 25 MB APK, tested on a real 2 GB phone — not a simulator |
| R11 | **Play Store rejection** | Launch delay of weeks | Medium | Working account deletion (M3), hosted privacy policy, correct permission rationale strings, data-safety form completed honestly, closed testing started early |
| R12 | **Data loss** — single server, no tested restore | Business-ending | Low probability, catastrophic impact | Automated daily `pg_dump` to object storage, 30-day retention, **a restore rehearsed before launch** (an untested backup is not a backup) |
| R13 | **Timezone / store-hours bugs** | Store "closed" at 2 PM | Medium | `stores.timezone` everywhere, explicit tests including overnight hours and DST-free assumptions |
| R14 | **Scope creep from the mockups** (ratings, wishlist, wallet, voice) | Launch slips by months | **High** | §3.2 is the contract; each is written down as deferred with a reason |
| R15 | **Secrets committed to git** | Compromise | Medium | `.env` git-ignored from commit 1, `.env.example` only, fail-fast env validation, secret scan in CI |

### 20.2 Open decisions — needed before / at Task 1.1

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| **O1** | Mobile state management | **Zustand + TanStack Query** (§7) | 14.1 |
| **O2** | Final 5 bottom-nav tabs | **Home · Categories · Search · Cart · Account** (Orders via Account + live-order banner) | 14.1, 14.6 |
| **O3** | OTP provider | **MSG91** (India-native, DLT-friendly); stub provider until approved | 2.1 |
| **O4** | Admin login method | **Email + password** (+ optional TOTP) — a store owner should not need an SMS to open the panel at 7 a.m., and OTP cost per login is avoidable | 13.1 |
| **O5** | Payment provider | **Razorpay** (best Indian docs/UPI coverage); Cashfree is a fine alternative | 9.1 |
| **O6** | Referral programme (mockup C5) | **Ship the screen informational-only behind `FEATURE_REFERRAL_ENABLED=false`**; build rewards in V2 | 14.15 |
| **O7** | Ratings & wishlist in UI (C3, C4) | **Remove from V1 screens** | 14.1, 14.7 |
| **O8** | Marketing delivery promise (C1) | **"in 30 minutes"** headline, computed ETA everywhere | 14.2, 14.6 |
| **O9** | RN tooling | **Expo (managed + dev-client)** — OTA updates and monorepo support | 0.2 |
| **O10** | ORM | **Prisma** | 1.2 |
| **O11** | Store's real coordinates, hours, radius, fees | Needed as **real values** for seed data | 1.4 |
| **O12** | GST registered? (affects receipt vs tax invoice, C9) | Owner input | 8.4, 17.3 |

---

## Approval

Task 0.1 is complete pending review. On approval, work proceeds to **Task 0.2 — monorepo skeleton** (which needs decision **O9**), then **0.3**, then **Task 1.1** where **O1–O12** are confirmed.

Deviations requiring explicit sign-off: **D2** (category tree), **D3** (`store_variants`), **D5** (status display mapping), and the mockup scope removals in **§2.1 C3, C4, C5, C8**.
