# AdiOne — Mobile App Technical Documentation

**Document:** 07 — Mobile (customer app) technical
**Scope:** `mobile/` — the React Native / Expo customer app
**Companion documents:** [01 — PRD & Architecture](01-PRD-and-Architecture.md) · [03 — Backend technical](03-backend-technical.md) · [04 — API reference](04-api-reference.md) · [06 — Deployment](06-deployment.md)

---

## Table of contents

1. [Stack and why](#1-stack-and-why)
2. [The operating environment](#2-the-operating-environment)
3. [Project layout](#3-project-layout)
4. [Build and tooling](#4-build-and-tooling)
5. [Navigation](#5-navigation)
6. [State: what lives where](#6-state-what-lives-where)
7. [The API client](#7-the-api-client)
8. [Session and token storage](#8-session-and-token-storage)
9. [Server-state hooks](#9-server-state-hooks)
10. [Cart behaviour](#10-cart-behaviour)
11. [Checkout and payment](#11-checkout-and-payment)
12. [Order tracking, realtime and polling](#12-order-tracking-realtime-and-polling)
13. [Location and serviceability](#13-location-and-serviceability)
14. [Push notifications](#14-push-notifications)
15. [Screens](#15-screens)
16. [Design system and localisation](#16-design-system-and-localisation)
17. [Error handling](#17-error-handling)
18. [Native configuration](#18-native-configuration)
19. [Store compliance](#19-store-compliance)
20. [Builds and release](#20-builds-and-release)
21. [Extension points](#21-extension-points)

---

## 1. Stack and why

| Concern | Choice | Reasoning |
|---|---|---|
| Framework | React Native 0.76 (New Architecture on) | |
| Toolchain | Expo SDK 52 | EAS Build removes a local Android toolchain from the critical path; config plugins keep native changes in version control |
| Language | TypeScript, `strict` | The mirrored contract makes the server's shapes compile-time facts |
| Navigation | React Navigation 7 (bottom tabs + native stacks) | |
| Server state | TanStack Query 5 | Caching and stale-while-revalidate on a bad network is the hard part |
| Client state | Zustand | Session, location, preferences. Nothing else |
| Secrets at rest | `expo-secure-store` | Keychain / Android Keystore |
| Realtime | socket.io-client | Matches the server; long-polling fallback matters here |
| Images | `expo-image` | Disk caching and progressive loading |
| i18n | i18next + react-i18next | English and Hindi |

---

## 2. The operating environment

Every notable decision in this app comes from the same three facts:

1. **The network is rural 3G.** Requests routinely succeed server-side while
   the response never arrives.
2. **The device is a mid-range Android phone.** Memory and CPU are finite; the
   bundle size is a real download cost.
3. **This may be the customer's first delivery app.** Copy is plain, errors are
   never technical, and permission prompts are asked for at the moment their
   purpose is obvious.

The single overriding rule that follows: **the app never computes a price, a
total, a delivery fee, an ETA, stock or serviceability. It asks and displays.**

---

## 3. Project layout

```
mobile/
├── App.tsx                     Root: QueryClient, NavigationContainer, auth gate
├── index.ts                    Expo entry
├── app.json                    Expo config: id, permissions, plugins, extra
├── eas.json                    Build profiles
├── babel.config.js             Module-resolver aliases
├── plugins/withUpiQueries.js   Android manifest <queries> for the upi: scheme
└── src/
    ├── navigation/             MainTabs · stacks · TabIcons · types
    ├── screens/                auth · location · home · catalog · cart · checkout · orders · account
    ├── components/             ProductCard · ProductGallery · ui.tsx
    ├── lib/                    api · queries · store · useCartActions · socket · push
    └── shared/                 GENERATED — mirrored from backend/src/shared
```

Aliases are declared **twice**, and both are needed: `babel.config.js`
(`babel-plugin-module-resolver`) resolves them at runtime, `tsconfig.json`
resolves them for the type checker.

> `@shared` maps to the **directory**, not to `index.ts`. Mapping it to the file
> breaks every subpath import — bare `@shared` still resolves through the
> directory's index, while `@shared/theme` resolves to the module.

---

## 4. Build and tooling

| Command | Effect |
|---|---|
| `npm start` | Expo dev server |
| `npm run android` / `npm run ios` | Native debug build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest |

### Environment

`EXPO_PUBLIC_*` variables are inlined at **build** time, so a change needs
`npx expo start --clear` or a rebuild. **They end up inside the APK and are
readable by anyone who unpacks it** — the API base URL is fine there, an API
key is not.

| Target | `EXPO_PUBLIC_API_URL` |
|---|---|
| Android emulator | `http://10.0.2.2:4000/api/v1` |
| iOS simulator | `http://localhost:4000/api/v1` |
| Physical device on the LAN | `http://<lan-ip>:4000/api/v1` |
| Tunnel / deployed | the public base + `/api/v1` |

Resolution order in `lib/api.ts`: `EXPO_PUBLIC_API_URL` →
`app.json`'s `extra.apiBaseUrl` → `http://10.0.2.2:4000/api/v1`.

---

## 5. Navigation

**Auth state drives navigation, not imperative `navigate` calls.** A session
expiring mid-flow lands the customer on login instead of on a screen that
silently fails every request.

```
status = loading         → <Loading />
status = anonymous       → Auth stack:  Splash → MobileEntry → OtpVerify
status = authenticated   → MainFlow:    LocationScreen (once) → MainTabs
```

Location is asked for **after** login, not before: a customer who has not yet
decided to use the app should not be met with a system permission dialog.

### Tabs

`Home · Categories · Search · Cart · Account`

Cart takes the fifth slot rather than Orders, because it needs a badge and
one-tap access constantly, while Orders matters only while an order is live —
and that case is covered by the persistent tracking banner plus an entry under
Account. The Cart badge reads `cart.bill.itemCount`.

Two tab-bar details that were fixed the hard way:

- The bar's height is `layout.tabBarHeight + insets.bottom`. A hard-coded height
  overrides the inset the navigator would otherwise add, and on gesture-nav
  devices the labels get squeezed into the strip behind the home indicator.
- Labels go through the navigator's own label slot (`tabBarShowLabel`), not
  faked inside `tabBarIcon`. The icon slot is width-constrained, which is what
  truncated "Home" to "Ho…".

### Per-tab stacks

Each tab owns its own stack, so back behaviour matches the customer's mental
model: backing out of a product opened from Search returns to Search, not to
Home. `ProductDetail` is therefore registered in the Home, Categories and
Search stacks — deliberate duplication, and cheaper than a shared modal stack
that breaks the back button.

Cross-tab jumps go through `navigation.getParent()`, so the tab bar and the
visible screen never disagree. Opening a category from Home switches to the
Categories **tab** with the category preselected, rather than pushing a listing
into the Home stack.

After checkout the app uses `navigation.replace`, not `navigate`: the customer
must not be able to press back into a checkout whose cart no longer exists.

---

## 6. State: what lives where

| Kind | Home | Contents |
|---|---|---|
| **Server state** | TanStack Query (`lib/queries.ts`) | Home feed, categories, products, search, cart, orders |
| **Client state** | Zustand (`lib/store.ts`) | `useAuth`, `useLocation`, `usePreferences` |
| **Module state** | `lib/api.ts`, `lib/socket.ts`, `lib/push.ts` | Access token, socket, registered push token |
| **UI state** | `useState` | Steppers, sheets, form drafts |

Query defaults in `App.tsx`:

```ts
retry: false,             // the API client already knows the difference between
                          // "offline" and "server error"; Query would retry both
staleTime: 30_000,
refetchOnWindowFocus: false,
mutations: { retry: false }
```

---

## 7. The API client

`lib/api.ts`. Written around a network where a request routinely succeeds while
its response is lost.

### Retries

| Method | Behaviour |
|---|---|
| `GET` | Up to 3 attempts, backoff `400 × 2^n` ms **plus up to 300 ms jitter** |
| `POST` / `PATCH` / `DELETE` | **Never** auto-retried |

Without jitter, every phone that lost signal in the same tunnel retries in
lockstep and hammers the API together.

A retried `POST /orders` is a second order. Retrying a mutation is a **user
action**, and it reuses the same `Idempotency-Key` so the server collapses it.

### Timeouts

15 s by default, 30 s for requests carrying an `Idempotency-Key` — order
placement legitimately takes longer, and aborting it is exactly the situation
idempotency exists to survive.

### Offline

A network failure or timeout becomes `ApiRequestError` with `status: 0`, which
the app renders as **"No internet connection"** — never as a server error.
`isRetryable` covers status 0, 5xx and 429; `isOffline` is status 0.

### Refresh

A `401` triggers a **single-flight** refresh: concurrent requests wait on one
attempt instead of stampeding and racing the token rotation. On failure the
tokens are cleared and `onSessionExpired` fires, which `App.tsx` wires to
`useAuth.clear()`.

### ngrok

Every request sends `ngrok-skip-browser-warning: true`. ngrok's free tier
serves an HTML interstitial to any request it thinks came from a browser
*instead of* proxying it; `fetch` then receives HTML where it expects JSON and
fails with a parse error that looks like a server bug. Harmless against any
other host, so it is sent unconditionally rather than sniffed for.

---

## 8. Session and token storage

| Token | Where | Why |
|---|---|---|
| Access | Module memory in `lib/api.ts` | Never at rest |
| Refresh | `expo-secure-store` (Keychain / Android Keystore) | **Never `AsyncStorage`**, which is plain text on a rooted device |

`useAuth` in `lib/store.ts`:

| Action | Behaviour |
|---|---|
| `setSession(result)` | Stores tokens, opens the socket with the access token, registers for push |
| `restore()` | Silent re-login on cold start via the stored refresh token, so the customer is not asked for an OTP daily |
| `logout()` | Revokes server-side, clears tokens, disconnects the socket, **forgets the push registration** |
| `clear()` | Local teardown when the server has already invalidated the session |

Forgetting the push registration on logout matters on a shared phone: without
it, the previous customer's order updates would keep arriving for whoever logs
in next.

---

## 9. Server-state hooks

`lib/queries.ts` exposes one hook per read, with a cache key registry so no
screen invents a key.

| Hook | Endpoint | Cache policy |
|---|---|---|
| `useHomeFeed()` | `GET /home` | Default |
| `useCategories()` | `GET /categories?includeChildren=true&withCounts=true` | `staleTime` 10 min — the tree changes a few times a month; refetching on every screen entry wastes a round trip the customer waits for |
| `useProducts({ categoryId, inStock })` | `GET /products?…&limit=30` | Default |
| `useProduct(id)` | `GET /products/{id}` | Default |
| `useSearch(term)` | `GET /products/search?q=…&limit=30` | `enabled` only at ≥ 2 characters |
| `useCart()` | `GET /cart` | **`staleTime: 0`** — always revalidated server-side, so a stale local copy is never used to decide anything |
| `useOrders()` | `GET /orders?limit=20` | Default |
| `useOrder(id, live)` | `GET /orders/{id}` | `refetchInterval: 30_000` while live |

Every one of these returns data the **server** computed — prices, stock, COD
eligibility, totals.

---

## 10. Cart behaviour

### The server's response replaces local state

`useCartMutations()` writes the mutation response straight into the cache with
`setQueryData`, rather than merging it. If the server corrected a quantity or
removed an out-of-stock line, **that correction is what the customer must
see** — a merge would quietly restore the item.

The cart DTO carries `changes[]` for exactly this, and the app renders them as
a notice strip rather than silently altering the basket.

### One place for add / increment / decrement

`useCartActions()` centralises the stepper behaviour — including what happens
when the server rejects — so it is identical on Home, the category grid, search
results and the product page. It also builds a `variantId → line` map, so a
grid renders quantities without a lookup per card.

`decrement` on the last unit sends `qty: 0`, which the API treats as "remove".

On failure it surfaces `error.message` from the server: **"Only 2 left in
stock" beats any generic copy the app could invent.**

---

## 11. Checkout and payment

```
Cart → Checkout → (UpiPayment) → OrderTracking
```

### Checkout

1. `POST /checkout/quote` with the chosen address and any coupon. The Review
   screen renders **the server's bill**; the app never computes a total.
2. The quote returns `codAllowed`, `codBlockedReason` and
   `availablePaymentMethods`. When COD is blocked, the reason names the item
   responsible, so the UI explains rather than hides.
3. `POST /orders` with an `Idempotency-Key` generated once per checkout attempt
   and reused on every retry. `expectedTotalPaise` is sent as a safety check —
   a mismatch returns `PRICE_CHANGED` and the customer re-confirms.

The screen then `replace`s to `UpiPayment` (online) or `OrderTracking` (COD).

### UPI payment

For `PAYMENT_PROVIDER=upi_intent`, `POST /payments/create` returns
`upiIntentUrl` and `requiresManualConfirmation: true`.

- The app opens the `upi://pay?…` deep link, handing the customer off to GPay,
  PhonePe or Paytm.
- **There is no callback**, because there is no gateway. The screen therefore
  shows "I have paid" rather than a spinner waiting for something that will
  never arrive.
- Tapping it calls `POST /payments/claim` with the optional 12-digit UTR from
  the customer's receipt. That records a *claim*; the store confirms the money
  in the admin panel.
- `GET /payments/{orderId}/status` is polled so the screen updates once the
  store confirms.

For a full gateway the same screen instead verifies via
`POST /payments/verify`, and the webhook and reconciliation job back it up.

---

## 12. Order tracking, realtime and polling

`lib/socket.ts` connects after login or refresh, authenticating the handshake
with the access token — the socket cannot open before a session exists, and it
is reopened after a rotation.

Transports are `['polling', 'websocket']` in that order: some Indian mobile
networks and proxies block websocket upgrades outright, and a silent fallback
beats a dead tracking screen. Reconnection backs off from 1 s to 10 s.

`useOrderSocket({ onStatusChanged })` holds its handlers in a `ref`, so
re-renders do not tear down and rebuild the subscription.

**And the tracking screen also polls every 30 seconds.** A screen that silently
stops updating is worse than one that costs a request every 30 seconds, and a
socket dying quietly on a flaky network must never be the only way a customer
learns their order is out for delivery.

The five-step timeline (`PLACED → CONFIRMED → PACKED → OUT_FOR_DELIVERY →
DELIVERED`) comes from the server in `OrderDetailDto.timeline`, mapped from the
twelve internal statuses by the shared state machine. In an exception state the
step is `null` and the screen shows a banner instead of a progress bar.

---

## 13. Location and serviceability

`useLocation` in `lib/store.ts`:

```ts
setLocation({ latitude, longitude, label })
  → GET /store/serviceability?lat=&lng=
  → { serviceable, distanceKm, maxRadiusKm, etaMinutes, deliveryFeePaise, storeOpen }
```

**The server decides.** The app only displays the answer — it never computes
serviceability itself and never acts on a cached verdict. The store also holds
`selectedAddressId`, so checkout knows which saved address the customer is
ordering to.

`LocationScreen` runs once per session before the tabs mount, and offers both
"use my location" (`expo-location`) and manual entry, because GPS in a
low-signal area is unreliable and a customer must never be stuck at a
permission dialog.

The API rejects `lat = 0` / `lng = 0` explicitly: a failed Android GPS fix
frequently yields `0, 0`, which is ~6,000 km away, and the customer would
otherwise be told "we don't deliver here" and blame the app.

---

## 14. Push notifications

`lib/push.ts`. **Registration is best-effort and never throws into the
caller** — a customer who declines notifications must still be able to shop.

- Skipped on a simulator, which has no push service.
- The permission is requested **only if the customer has not been asked
  before**. Re-asking someone who already said no is the fastest way to be
  uninstalled.
- Android needs a channel (`orders`, high importance) or 8+ ignores the
  notification entirely.
- The Expo push token is posted to `POST /devices`, and is **not re-posted if
  unchanged** — wasted traffic on a connection where every request costs the
  customer something.
- `forgetPushRegistration()` on logout, for shared phones.

The server upserts on the token, so a reinstall moves it to the new user rather
than leaving two rows pointing at the same device.

A foreground handler shows a banner with sound, so a live order update is
noticed while the app is open.

---

## 15. Screens

| Screen | Purpose | Key calls |
|---|---|---|
| `SplashScreen` | First-run introduction | — |
| `MobileEntryScreen` | 10-digit number, normalised server-side | `POST /auth/send-otp` |
| `OtpVerifyScreen` | OTP entry, resend cooldown, attempt limit | `POST /auth/verify-otp` |
| `LocationScreen` | GPS or manual location, serviceability verdict | `GET /store/serviceability` |
| `HomeScreen` | Banners, categories, product rails, in one call | `GET /home` |
| `CategoriesScreen` | Category tree and product grid | `GET /categories`, `GET /products` |
| `SearchScreen` | Debounced search from 2 characters | `GET /products/search` |
| `ProductDetailScreen` | Gallery, variants, stock, related, notify-me | `GET /products/{id}`, `…/related`, `POST …/notify-me` |
| `CartScreen` | Lines, corrections strip, coupon, bill | `GET /cart`, `/cart/items`, `/cart/coupon` |
| `CheckoutScreen` | Address, payment method, server bill, place order | `POST /checkout/quote`, `POST /orders` |
| `UpiPaymentScreen` | UPI deep link, "I have paid", status polling | `POST /payments/create`, `/payments/claim`, `GET /payments/{id}/status` |
| `OrderTrackingScreen` | Timeline, ETA, agent, delivery OTP, cancel | `GET /orders/{id}`, `POST /orders/{id}/cancel` |
| `OrdersListScreen` | Ongoing / delivered / cancelled | `GET /orders` |
| `AccountScreen` | Menu | — |
| `PersonalInfoScreen` | Name and email | `GET/PATCH /auth/me` |
| `AddressesScreen` / `AddressFormScreen` | Saved addresses with serviceability | `/addresses` |
| `HelpScreen` | Support phone, WhatsApp, email from config | `GET /config/public` |
| `AboutScreen` | Store details, app version | `GET /store` |
| `LegalScreen` | Privacy and terms | `GET /legal/{slug}` |

---

## 16. Design system and localisation

`components/ui.tsx` holds the primitives; `@shared/theme` holds the tokens
(colours, spacing, radii, type scale, `layout.tabBarHeight`). The same tokens
back the admin panel's Tailwind config, so a status badge is the same green in
both products.

`ProductCard` and `ProductGallery` are the two composite components, used
across Home, Categories, Search and the product page so that price, discount
badge, stock state and the quantity stepper look and behave identically
everywhere.

**Localisation** is i18next + react-i18next, English and Hindi.
`usePreferences.language` holds the choice. Catalogue content carries its own
translations from the server (`nameHi`, `descriptionHi`) rather than living in
the bundle, so the store owner can add Hindi names without an app release.

---

## 17. Error handling

Every API error carries a stable `code` and a message that is **safe to show a
user as-is** by contract, so this app maps no strings.

| Situation | What the customer sees |
|---|---|
| `status: 0` | "No internet connection. Please check and try again." |
| Any API error | The server's `message`, verbatim |
| Unknown failure | "Something went wrong. Please try again." |

Codes are switched on only where behaviour genuinely differs — `PRICE_CHANGED`
returns the customer to the bill for re-confirmation, `TOKEN_EXPIRED` is
handled inside the client by the refresh path, `OUT_OF_SERVICE_AREA` routes to
the "we don't deliver here yet" screen.

---

## 18. Native configuration

`app.json`:

| Setting | Value |
|---|---|
| Application id | `in.adione.app` (Android package and iOS bundle) |
| Orientation | Portrait |
| Scheme | `adione` |
| New Architecture | Enabled |
| Android permissions | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `INTERNET`, `POST_NOTIFICATIONS` |
| Plugins | `expo-location`, `expo-secure-store`, `./plugins/withUpiQueries` |

Both platforms declare the same location purpose string: *"AdiOne uses your
location to check whether we deliver to your area and to estimate your delivery
time."*

### `plugins/withUpiQueries.js`

Android 11 (API 30) restricts which other apps a package can see. Without a
matching `<queries>` entry, `Linking.canOpenURL('upi://pay?…')` returns
**false** even when GPay, PhonePe and Paytm are all installed — so the checkout
screen would tell every customer "No UPI app found" and no order could ever be
paid.

The generated manifest only declares the `https` scheme, so this plugin adds
the `upi` one. It lives in a config plugin rather than in `android/` directly
because `expo prebuild --clean` regenerates that folder and would silently drop
the edit.

---

## 19. Store compliance

| Requirement | How it is met |
|---|---|
| In-app account deletion (Google Play) | `DELETE /auth/me`, wired to Account → Delete account. It actually erases; a button that does nothing is a listing rejection |
| Right to erasure (India, DPDP Act) | The same endpoint |
| Publicly reachable privacy policy | `GET /api/v1/legal/privacy/page` serves plain HTML at a public URL. A screen inside the app does not satisfy this |
| Terms | `GET /api/v1/legal/terms/page`, and in-app via `LegalScreen` |
| Location purpose strings | Declared in `app.json` for both platforms |
| Notification permission | Requested once, declined is respected |

The legal pages are rendered from **one** definition on the server, in both JSON
and HTML, so the in-app text and the public page can never drift apart.

---

## 20. Builds and release

```bash
npx eas build --profile development --platform android   # dev client
npx eas build --profile preview     --platform android   # internal APK
npx eas build --profile production  --platform android   # Play Store AAB
```

Each profile in `eas.json` pins its own `EXPO_PUBLIC_API_URL` — `preview` at
the tunnel, `production` at `https://api.adione.in/api/v1`. `appVersionSource`
is `local`, so `app.json`'s `version` and `android.versionCode` are the source
of truth and a release is a reviewable diff.

Deployment sequencing is in [06 — Deployment](06-deployment.md).

---

## 21. Extension points

| Future capability | What it takes |
|---|---|
| Wishlist, ratings, referrals | Feature flags already exist in `GET /config/public`, off by deliberate decision. The screens gate on them |
| Repeat order | `GET /orders/{id}` already returns full line items |
| Multi-store | Serviceability already returns a store-scoped answer; add store selection to the location flow |
| Another vertical | `CatalogVertical` reaches the client on categories; branch presentation on it, never on a category name |
| Offline browsing | Query's cache is already the read path; add a persister |
| iOS release | Bundle id, plugins and permission strings are already configured; only signing and a build profile are missing |
