# AdiOne — Deployment & Production Checklist

**Tasks:** 17.1–17.3

---

## 1. What runs where

```
            +--------------------------+
  Internet -| Caddy / Nginx  (TLS, 443)|
            +------------+-------------+
                         |
              +----------v---------+
              |  web  (nginx:80)   |  store panel + /api proxy
              +----------+---------+
                         |  internal network only
              +----------v---------+
              |  api  (node:4000)  |
              +----+----------+----+
                   |          |
          +--------v--+   +---v------+
          | postgres  |   |  redis   |
          +-----------+   +----------+
                   |
             +-----v-----+
             |  backup   |  nightly pg_dump, 14-day retention
             +-----------+
```

Only `web` publishes a port. Postgres, Redis and the API are reachable solely
on the internal Docker network — an exposed database is the single most common
way a small deployment is compromised.

A 2 vCPU / 4 GB VPS is comfortably sufficient for the V1 load (about Rs 1,500 to
Rs 3,000 per month). The most important production decision is not the host: it
is that **backups are automated and a restore has actually been rehearsed**
(section 6).

---

## 2. Environment separation (Task 17.2)

| Environment | Config file | Database | Providers |
|---|---|---|---|
| development | `backend/.env` | `adione` | console OTP, mock payments, node-cache, local storage |
| test | `backend/.env.test` | `adione_test` | all stubs, isolated DB |
| production | `backend/.env.production` | managed / container Postgres | MSG91, Razorpay, Redis, S3 |

The environment validator **refuses to boot production** with a development
stub configured — console OTP, mock payments or local disk storage. That is a
hard failure at startup, not a warning, because each silently breaks a
guarantee the system otherwise makes.

It equally refuses to run tests against a database whose name does not end in
`_test`. (That guard exists because a test run once truncated the development
database — see the incident log in `PROGRESS.md`.)

### The cache: `REDIS`

One switch selects the backend.

| Setting | Backend | Behaviour |
|---|---|---|
| `REDIS=false` *(default)* | in-process `node-cache` | Runs with nothing but PostgreSQL installed. **OTP and rate-limit state is lost on restart and is not shared between instances.** |
| `REDIS=true` | Redis (`REDIS_URL` required) | State survives restarts and is shared across processes. |

Production defaults to requiring `REDIS=true`. If you are running a **single**
API instance and accept that a restart forgets in-flight OTPs and resets rate
limits, set `ALLOW_MEMORY_CACHE_IN_PRODUCTION=true` — a deliberate opt-in
rather than a blocked door.

### Generate real secrets before first deploy

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # OTP_PEPPER
```

Never reuse development values; never commit `.env.production`.

---

## 3. Deploying

```bash
# on the server
git clone <repo> adione && cd adione

cp backend/.env.example backend/.env.production
#   fill in: JWT_SECRET, OTP_PEPPER, MSG91_*, RAZORPAY_*, S3_*, ADMIN_*
#   set: OTP_PROVIDER=msg91  PAYMENT_PROVIDER=razorpay
#        REDIS=true          STORAGE_PROVIDER=s3

cat > .env <<'EOF'
POSTGRES_USER=adione
POSTGRES_PASSWORD=<strong-random-password>
POSTGRES_DB=adione
EOF

docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically before the server starts, and a migration failure
stops the container rather than letting it serve against an outdated schema.

**Seed reference data once** (configuration, store, categories, admin login).
Demo products are skipped automatically because `NODE_ENV=production`:

```bash
docker compose -f docker-compose.prod.yml exec api npx tsx prisma/seed/index.ts
```

Then **change the admin password immediately** and replace the placeholder
store coordinates, hours and support numbers from the panel's Settings screen —
they are seed data, not code.

### Deploy order for later releases

Migrations run **before** the new code. Every migration must therefore be safe
against the *previous* version still running: add nullable, backfill, then make
required in a later release. Never rename or drop a column in the same release
that stops using it.

---

## 4. TLS and the reverse proxy

`web` listens on `8080`. Terminate TLS in front of it — Caddy is the least work:

```
adione.example.in {
    reverse_proxy localhost:8080
}
```

The webhook endpoint must be publicly reachable at
`https://<domain>/api/v1/payments/webhook`, and that URL is what gets
registered in the Razorpay dashboard. Its signature is computed over the **raw
request body**, so any proxy in front must not rewrite or re-encode it.

---

## 5. Pre-launch checklist

### Blocking — the app cannot launch without these

- [ ] **DLT / TRAI registration** for the SMS sender ID and OTP template.
      3 to 10 working days, often longer. **Start this first** — it is the most
      under-estimated blocker in Indian app launches, and OTP login is dead
      without it.
- [ ] **Razorpay KYC**: business proof, bank account, GSTIN if applicable (3 to 7 days).
- [ ] **Google Play developer account** + closed testing (new accounts require a
      testing period before production release).
- [ ] **Privacy policy and T&C hosted at a public URL** — Play Store submission
      requires it, and three screens link to it.
- [ ] Real store coordinates, opening hours, delivery fees and support numbers
      entered in Settings.
- [ ] Product catalogue and photography loaded.

### Security

- [ ] `JWT_SECRET` and `OTP_PEPPER` freshly generated, 32+ chars, not the examples.
- [ ] `.env.production` is not in git (`git check-ignore backend/.env.production`).
- [ ] Admin password changed from the seed default.
- [ ] `CORS_ORIGINS` lists only the real panel domain.
- [ ] Postgres uses a least-privilege role (no `SUPERUSER`, no `CREATE`).
- [ ] Only ports 80/443 open on the host firewall.

### Correctness

- [ ] `npm test` in `backend/` — 126 tests green, including the overselling,
      idempotency and end-to-end lifecycle tests.
- [ ] Place one real Rs 1 order end to end and confirm the money arrives.
- [ ] Fire a test webhook and confirm the order settles.
- [ ] Confirm the store panel chimes on a new order **on the actual counter tablet**.

### Operations

- [ ] `docker compose logs api` is clean at startup.
- [ ] `/health/ready` returns 200 through the public domain.
- [ ] Nightly backup file present in `./backups` after 24 hours.
- [ ] **Restore drill completed** (section 6).
- [ ] Sentry DSN configured, or a documented decision not to.

---

## 6. Backups — and the restore drill

The `backup` service takes a nightly `pg_dump -Fc` into `./backups`, retained
for 14 days.

**A backup that has never been restored is not a backup.** Do this once before
launch and once a quarter:

```bash
# 1. take a fresh dump
docker compose -f docker-compose.prod.yml exec backup \
  pg_dump -h postgres -U adione -d adione -Fc -f /backups/drill.dump

# 2. restore it into a scratch database
docker compose -f docker-compose.prod.yml exec postgres \
  createdb -U adione adione_restore_drill
docker compose -f docker-compose.prod.yml exec postgres \
  pg_restore -U adione -d adione_restore_drill /backups/drill.dump

# 3. confirm the data is actually there
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U adione -d adione_restore_drill -c \
  "SELECT (SELECT count(*) FROM orders) AS orders,
          (SELECT count(*) FROM products) AS products,
          (SELECT count(*) FROM users) AS users;"

# 4. clean up
docker compose -f docker-compose.prod.yml exec postgres \
  dropdb -U adione adione_restore_drill
```

Copy dumps off the host as well — a backup living only on the machine it backs
up protects against nothing.

---

## 7. Monitoring

V1 keeps this deliberately small:

- **Structured JSON logs** (pino) with a request id on every line, so a
  customer's "something went wrong" screenshot maps to exact server logs.
- **`/health/ready`** checks the database and cache; point an uptime monitor at it.
- **What to actually watch:** `payment_events` rows with a non-null `error`
  (unsettled money), orders stuck in `PENDING_PAYMENT` beyond the hold window,
  and the low-stock count.

Sentry is wired but inert until a DSN is set.

---

## 8. Rollback

```bash
git checkout <previous-tag>
docker compose -f docker-compose.prod.yml up -d --build api web
```

Rolling **code** back is safe. Rolling a **migration** back generally is not —
which is why migrations must be backwards-compatible with the previous release.
If a migration has to be undone, restore from the pre-deploy backup rather than
hand-editing the schema.
