# AdiOne — Admin Panel Technical Documentation

**Document:** 05 — Web (store / admin panel) technical
**Scope:** `web/` — the React SPA the shopkeeper runs at the counter
**Companion documents:** [01 — PRD & Architecture](01-PRD-and-Architecture.md) · [03 — Backend technical](03-backend-technical.md) · [04 — API reference](04-api-reference.md) · [06 — Deployment](06-deployment.md)

---

## Table of contents

1. [Stack and why](#1-stack-and-why)
2. [Project layout](#2-project-layout)
3. [Build and tooling](#3-build-and-tooling)
4. [Application shell and routing](#4-application-shell-and-routing)
5. [State: what lives where](#5-state-what-lives-where)
6. [The API client](#6-the-api-client)
7. [Session and authorisation](#7-session-and-authorisation)
8. [Realtime and polling](#8-realtime-and-polling)
9. [Screens](#9-screens)
10. [Image handling and uploads](#10-image-handling-and-uploads)
11. [Design system](#11-design-system)
12. [Formatting](#12-formatting)
13. [Error handling](#13-error-handling)
14. [Accessibility and the counter environment](#14-accessibility-and-the-counter-environment)
15. [Production build and serving](#15-production-build-and-serving)
16. [Extension points](#16-extension-points)

---

## 1. Stack and why

| Concern | Choice | Reasoning |
|---|---|---|
| Framework | React 18 | |
| Build | Vite 5 | Instant dev server, and a static `dist/` that needs no Node at runtime |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` | The mirrored contract makes it a compile error to invent a field the server does not send |
| Routing | React Router 6 | |
| Server state | TanStack Query 5 | Caching, background refetch and per-screen poll intervals are exactly the hard part |
| Client state | Zustand | Session only. Small enough to read in one screen |
| Styling | Tailwind CSS 3 | The panel is one product with one designer; utility classes keep the whole style of a component visible in the component |
| Realtime | socket.io-client | Matches the server |

**No component library.** `src/components/ui.tsx` holds the ~20 primitives this
panel actually uses, built on the same design tokens as the mobile app. A
general-purpose library would have been more code to override than to write.

---

## 2. Project layout

```
web/
├── index.html
├── vite.config.ts          Aliases + the dev proxy
├── tailwind.config.js      Brand tokens, mirrored from shared/theme.ts
├── nginx.conf              Production serving and proxying
├── Dockerfile              Build → static Nginx image
└── src/
    ├── main.tsx            QueryClient, BrowserRouter, StrictMode
    ├── App.tsx             Auth gate, shell, routes
    ├── index.css           Tailwind layers
    ├── pages/              One file per route
    ├── components/
    │   ├── ui.tsx          Icon · Button · Field · Modal · StatCard · StatusPill · Table parts …
    │   ├── StoreAvailabilityCard.tsx  Trading switch + weekly opening hours
    │   └── StoreLocationCard.tsx
    ├── lib/
    │   ├── api.ts          fetch wrapper, envelope unwrapping, single-flight refresh
    │   ├── auth.ts         Zustand session store
    │   ├── socket.ts       Socket.IO subscription hook
    │   ├── upload.ts       Presign → PUT → attach
    │   ├── image.ts        Same-origin image URL rewriting
    │   └── format.ts       Re-exports the shared formatters
    └── shared/             GENERATED — mirrored from backend/src/shared
```

Aliases (`vite.config.ts` + `tsconfig.json`): `@/…` → `src/…`, `@shared` → the
mirrored contract, `@shared/…` → individual modules.

> The alias is declared in Vite's **array** form with anchored regexes. The
> object form prefix-matches, so a plain `@shared` key would resolve
> `@shared/money` to `src/shared/index.ts/money`, and the exact-match rule has
> to come first.

---

## 3. Build and tooling

| Command | Effect |
|---|---|
| `npm run dev` | Vite on :5173 with the API proxy |
| `npm run build` | `tsc -b` then `vite build` → `dist/` with source maps |
| `npm run preview` | Serve the built output |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over `src` |

### The dev proxy

`vite.config.ts` proxies three paths to `http://localhost:4000`:

| Path | Why |
|---|---|
| `/api` | The browser sees a same-origin API, so CORS never enters the picture in development |
| `/socket.io` | With `ws: true` for the upgrade |
| `/static` | Product images **must** be same-origin — see [§10](#10-image-handling-and-uploads) |

### Environment

Vite inlines `VITE_*` at **build** time; changing one needs a restart or a
rebuild. These values ship to the browser, so no secrets belong here.

| Variable | Effect |
|---|---|
| `VITE_API_URL` | Absolute API base. Blank → `/api/v1` via the proxy or Nginx |
| `VITE_SOCKET_URL` | Absolute socket origin. Blank → same origin |

---

## 4. Application shell and routing

`App.tsx` is the auth gate *and* the shell.

```
status = loading     → <Spinner label="Restoring session…" />
status = anonymous   → <LoginPage />          (the router is never mounted)
status = authenticated → <Shell><Routes/></Shell>
```

Unauthenticated users never reach the router at all, so there is no
`<ProtectedRoute>` wrapper to forget on a new page.

| Path | Page |
|---|---|
| `/` | Dashboard |
| `/orders` | Orders |
| `/products` | Products |
| `/categories` | Categories |
| `/inventory` | Inventory |
| `/customers` | Customers |
| `/delivery` | Delivery |
| `/settings` | Configuration |
| `*` | Redirect to `/` |

### Shell

- A permanent 64-unit sidebar rail from `lg` up; a slide-over below it, because
  the counter tablet is often held in portrait.
- The top bar derives its title and subtitle from the **longest matching**
  navigation prefix, so `/products/new` still reads as "Products".
- A store card in the sidebar footer shows the live service radius, read from
  `GET /config/public` with a 5-minute `staleTime`.

---

## 5. State: what lives where

| Kind | Home | Examples |
|---|---|---|
| **Server state** | TanStack Query | Orders, products, inventory, agents, configuration |
| **Client state** | Zustand (`lib/auth.ts`) | The session: user, status |
| **Module state** | `lib/api.ts`, `lib/socket.ts` | Tokens, the socket instance |
| **UI state** | `useState` in the component | Modals, filters, form drafts |

Query defaults, set once in `main.tsx`:

```ts
refetchOnWindowFocus: false,   // the panel runs on a tablet all day; refetching
                               // on every focus hammers the API for no news
retry: 1,
staleTime: 10_000,
mutations: { retry: 0 }
```

Each screen sets its own `refetchInterval` instead — see
[§8](#8-realtime-and-polling).

---

## 6. The API client

`lib/api.ts` is a thin `fetch` wrapper with two responsibilities it must get
right.

### 1. Token placement

**Access token in memory, refresh token in `localStorage`.** An XSS on the
panel would otherwise hand over a session that can refund orders. The refresh
token is persisted because the owner should not re-login every 15 minutes at
the counter.

### 2. Single-flight refresh

A `401` triggers **one** refresh; concurrent requests wait on it rather than
each firing their own and racing the rotation. `retried` on the options guards
against an infinite loop. When the refresh fails, tokens are cleared and the
registered `onSessionExpired` handler drops the session — `App.tsx` uses it to
disconnect the socket and return to the login page, rather than leaving the
panel showing stale data.

### Envelope handling

`request<T>()` returns `body.data` directly and throws `ApiRequestError` —
carrying `code`, `message`, `status` and `requestId` — on `success: false`.
`204` returns `undefined`. Callers therefore work with domain data, never with
the envelope.

Every request carries `ngrok-skip-browser-warning: true`. ngrok's free tier
answers browser-looking requests with an HTML interstitial *instead of*
proxying them, so `fetch` receives HTML where it expects JSON; the header
suppresses that page and is harmless against any other host.

---

## 7. Session and authorisation

`lib/auth.ts` (Zustand):

| Action | Behaviour |
|---|---|
| `login(email, password)` | Calls **`POST /auth/admin/login`** — not the general endpoint — so a customer with valid credentials cannot get into the panel |
| `restore()` | On page load, exchanges the stored refresh token for a session |
| `logout()` | Revokes server-side, then clears. Clearing `localStorage` alone would leave the session usable by anyone holding the token |
| `clear()` | Local-only teardown, used when the server has already invalidated the session |

The panel does not implement per-permission UI gating in V1: every role that can
sign in here can use the screens it can reach, and the **server** rejects
anything the role lacks. That keeps authorisation in one place.

---

## 8. Realtime and polling

`lib/socket.ts` exposes `useOrderSocket({ onNewOrder, onStatusChanged }, storeId)`.

- The handshake carries the in-memory access token, so the socket is only
  opened once a session exists.
- Handlers are held in a `ref`, so re-renders do not tear down and rebuild the
  subscription on every keystroke in the search box.
- `store:subscribe` is emitted on `connect` (and immediately if already
  connected) to join the store room.

**Realtime is deliberately best-effort.** Every screen that uses it also polls:

| Screen | Interval |
|---|---|
| Orders | 20 s |
| Dashboard | 30 s |
| Customers | 60 s `staleTime` |

A socket that dies silently on a flaky counter connection must not be the only
signal, because a missed new order is the most expensive failure in the shop.

### The new-order chime

`Orders.tsx` synthesises the chime with **WebAudio** rather than shipping an
audio file — no asset, and it works offline. Two details are load-bearing:

- **It repeats every 10 seconds until acknowledged.** A chime heard once while
  nobody is at the counter is the same as no chime at all.
- **Browsers block audio until the user interacts with the page.** A visual
  banner is therefore shown alongside it, so a blocked chime still surfaces the
  order.

---

## 9. Screens

| Page | What it does | Key endpoints |
|---|---|---|
| **Login** | Email + password | `POST /auth/admin/login` |
| **Dashboard** | Today's orders and revenue, status breakdown, low stock | `GET /admin/dashboard`, `GET /config/public` |
| **Orders** | The order board: tabs, search, status transitions, agent assignment, manual payment confirmation | `GET /admin/orders`, `PATCH /admin/orders/{id}/status`, `POST …/assign`, `POST …/confirm-payment`, `GET /admin/delivery-agents` |
| **Products** | Product and variant CRUD, image upload | `GET/POST/PATCH/DELETE /admin/products`, `/admin/variants`, `/admin/uploads/presign`, `/admin/product-images` |
| **Categories** | Category tree | `/admin/categories`, `GET /categories?includeChildren=true` |
| **Inventory** | Stock, pricing, availability, limits, ledger | `PATCH /admin/store-variants/{id}/…`, `GET /admin/inventory/low-stock` |
| **Customers** | Customers and their order history | Derived from `GET /admin/orders?tab=…&limit=50` |
| **Delivery** | Agents and cash settlement | `/admin/delivery-agents`, `GET /admin/delivery/cash-summary` |
| **Configuration** | Every business rule, with its description | `GET/PATCH /admin/config`, `PATCH /admin/store` |

### Two screens worth explaining

**Orders** is the panel's reason to exist. The tab set comes from
`ADMIN_TAB_STATUSES` in the shared contract, so it cannot drift from the
server's grouping. Which action buttons render for a given order is decided by
`ALLOWED_TRANSITIONS` — the same table the server validates against — which is
precisely why the state machine lives in `shared/` rather than in the API.

The `PAYMENT_PENDING` tab exists for direct-UPI orders, showing the customer's
claimed UTR next to a "Confirm payment" action. Without it, an order whose
customer paid by UPI would be invisible to the shopkeeper until it expired.

**Customers** has no dedicated endpoint in V1. It aggregates the order feed
client-side. That is an honest V1 trade-off: a customers table with search and
pagination is a backend feature, and the order feed already carries the name,
mobile, order count and spend that the screen shows.

---

## 10. Image handling and uploads

### Why images are rewritten to the panel's own origin

The API stores absolute image URLs built from `STORAGE_PUBLIC_BASE_URL`. That
is right for the mobile app and wrong here, twice over:

1. An `<img>` tag **cannot send custom headers**, so it cannot carry
   `ngrok-skip-browser-warning`. Behind a free tunnel the browser receives the
   HTML interstitial instead of the image and Chrome blocks it with
   `ERR_BLOCKED_BY_ORB` — an error that looks like a storage problem but is a
   tunnelling one.
2. A panel served over `https` loading images over `http` is mixed content.

`lib/image.ts` therefore trims any stored URL back to its bare `/static/…`
path, and whatever serves the panel proxies it: the Vite dev server locally,
Nginx in production. URLs that are not ours (an external CDN) are left alone.
With `STORAGE_PROVIDER=s3` the API serves no `/static` and the rewrite is inert.

### The upload flow

```
1. POST /admin/uploads/presign   { fileName, contentType }  →  { uploadUrl, key, headers }
2. PUT  <uploadUrl>              raw bytes + returned headers
3. POST /admin/product-images    { productId, variantId?, key, altText? }
```

Bytes never travel through the API's JSON body.

Step 2 is the awkward one. With `STORAGE_PROVIDER=local` the target is our own
`/admin/uploads/direct` route, which sits behind the admin auth gate and needs
the bearer token. With `s3` it is a presigned URL on another host, where an
`Authorization` header would break the signature. So the token is attached only
when the target is our own API — and that decision is keyed on the **path**,
not the origin:

> An earlier version compared origins and broke the moment the API handed back a
> `localhost` upload URL while the panel was pointed at a tunnel. The origins
> differed, the token was withheld as if this were S3, and every upload 401'd.
> The route is ours by definition and a presigned S3 URL never carries it, so
> the path is the reliable signal.

Client-side validation mirrors the server: JPEG / PNG / WebP / AVIF, ≤ 5 MB, so
an oversized file fails before it is uploaded. A `401` from step 2 produces a
specific message about `API_BASE_URL` being misconfigured, because retrying
cannot fix that.

---

## 11. Design system

`components/ui.tsx` — primitives shared by every screen:

`Icon` · `Surface` · `Card` · `Panel` · `StatCard` · `Stat` · `Button` ·
`Field` · `SearchInput` · `Pill` · `StatusPill` · `Modal` · `ErrorBanner` ·
`EmptyState` · `Spinner` · `TableWrap` / `Th` / `Td` / `Thumb`

Colours in `tailwind.config.js` mirror `shared/theme.ts`, so the admin status
pill and the customer's order badge are the same green. `StatusPill` maps an
`OrderStatus` to a tone and the label from `ORDER_STATUS_LABELS` — no screen
hand-writes a status string.

Icons are inline SVG paths in one `Icon` component, so no icon package ships in
the bundle.

---

## 12. Formatting

`lib/format.ts` is a re-export barrel, not an implementation:

```ts
export { formatPaise, formatPaiseNumber, discountPercent } from '@shared/money';
export { formatRelativeTime, formatDateTimeInZone }        from '@shared/datetime';
export { formatIndianMobile }                              from '@shared/phone';
export { formatDistance, formatEtaRange }                  from '@shared/distance';
```

The panel and the app format ₹, distances and relative times with the *same*
functions, so "₹1,299" and "2.4 km" read identically in both. The panel formats;
it never computes.

---

## 13. Error handling

Every API error carries a stable `code` and a message that is **safe to display
as-is** by contract, so there is no string-mapping table in this app. Screens
render `ErrorBanner` with `error.message` and log `requestId` where it helps
support.

Codes are switched on only where the UI genuinely differs — for example
`INVALID_STATUS_TRANSITION` refetches the order (someone else already moved it)
rather than just showing a banner.

---

## 14. Accessibility and the counter environment

The panel is used on a tablet, often one-handed, often by someone who is also
serving a customer. That shaped a few concrete choices:

- **Minimum 44 px touch targets** on navigation and action buttons
  (`min-h-11` on nav items).
- **Slide-over navigation below `lg`**, because the tablet is often portrait.
- **The repeating chime plus a visual banner**, so a new order is noticed
  whether or not audio is permitted.
- **Explicit `aria-label`s** on icon-only buttons (menu, notifications, close).
- **Polling on every live screen**, so the panel is never quietly stale.
- **No destructive action without a modal confirmation.**

---

## 15. Production build and serving

`npm run build` produces a static `dist/`. The `Dockerfile` builds it in a Node
stage and serves it from `nginx:1.27-alpine` — roughly 25 MB, with no Node
process serving files it never changes.

`nginx.conf`:

| Rule | Why |
|---|---|
| `/assets/` → `Cache-Control: public, immutable`, 1 year | Filenames are content-hashed |
| `/index.html` → `no-cache, no-store, must-revalidate` | It is what points at the new asset hashes after a deploy; a cached copy pins staff to the old build |
| `/api/` → `proxy_pass http://api:4000` | One origin, so CORS never applies to the panel |
| `/socket.io/` → proxied with `Upgrade`, 3600 s read timeout | |
| `/static/` → proxied, cached 7 days | Same-origin images (see [§10](#10-image-handling-and-uploads)) |
| `try_files $uri $uri/ /index.html` | SPA fallback |
| `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` | |

Deployment details are in [06 — Deployment](06-deployment.md).

---

## 16. Extension points

| Future capability | What it takes |
|---|---|
| Permission-aware UI | The role → permission map is already in `@shared/permissions`; gate nav items and buttons on it |
| A real Customers screen | A backend endpoint; the page already models the shape |
| Coupons management | The config flag and the `Coupon` model exist; add a page and admin routes |
| Reports and exports | The dashboard endpoint is the seam |
| A second store | Add a store switcher; every admin query is already store-scoped server-side |
| Dark mode | Tokens are already centralised in `tailwind.config.js` / `shared/theme.ts` |
