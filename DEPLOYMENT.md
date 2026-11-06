# HERMIPLAN — Netlify Deployment

This guide matches the actual implementation. It assumes Next.js 16 (App Router,
Turbopack), PostgreSQL via Drizzle ORM, and Netlify's OpenNext Next.js adapter —
which this repository pins explicitly (see §2, step 3).

> **"Page not found" on every URL?** That is the signature of a deploy that
> published the raw `.next` output without the adapter. Diagnose it in one
> command (`npm run deploy:check -- --url https://<site>.netlify.app`) and follow
> `docs/NETLIFY-DEPLOY.md`.

---

## 1. Accounts and external services

| Service | Required | Purpose |
| --- | --- | --- |
| Netlify account | yes | hosting, SSR functions, deploy previews |
| PostgreSQL database reachable from the internet | yes | projects, users, sessions, OTP codes, audit events |
| SMS provider | only for phone login | OTP delivery |
| Market-rate feed | optional | live Iranian market rates |

Managed Postgres options that work well from serverless functions:
**Neon**, **Supabase**, **AWS RDS**. Use the **pooled** connection string
(Neon pooled endpoint / Supabase transaction pooler, port `6543`) — each Netlify
function instance opens its own connection pool.

---

## 2. Connect the repository

1. Push the repository to GitHub/GitLab. `.gitignore` excludes `.env`,
   `node_modules`, `.next` and `.netlify`, so no credentials are committed.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
   Leave **Base directory** empty — the app lives at the repository root, and
   detection silently stops working when it is set.
3. Netlify normally installs its maintained OpenNext adapter automatically.
   This repository **pins it anyway** (`[[plugins]]` in `netlify.toml` plus
   `@netlify/plugin-nextjs` in `devDependencies`), because on 2026-11-06 the
   deployment published the raw `next build` output with no adapter, and every
   URL answered Netlify's own "Page not found". Pinning is the documented way
   to make that step explicit and reproducible. Trade-off: the adapter no
   longer updates on its own — bump the version deliberately (see
   `docs/NETLIFY-DEPLOY.md` §3, which also explains how to opt back in).
4. Build settings come from `netlify.toml` (already committed):
   `command = "npm run build"`, `publish = ".next"`, `NODE_VERSION = "22"`
   (also pinned in `.nvmrc`). Netlify runs `npm install` because only
   `package-lock.json` is committed. Dev dependencies must be installed —
   `typescript`, `@types/*` and the Tailwind PostCSS plugin are needed by
   `next build`; if a dashboard-level `NODE_ENV=production` skips them the
   build fails.
5. Never deploy build output directly (`netlify deploy --dir=.next`): it
   bypasses the adapter and reproduces the 404. Deploy from Git, or
   `netlify deploy --build --prod`.
6. Verify the deployment instead of trusting the build log:
   `npm run deploy:check -- --url https://<site>.netlify.app` (exit 0 = healthy;
   it also detects the "raw `.next` published" fingerprint).
7. Optional but recommended: enable `.github/workflows/deploy.yml` by adding the
   `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` repository secrets. It deploys with
   `netlify deploy --build --prod` (build **and** pinned adapter) and verifies the
   live site afterwards, so a deployment no longer depends on dashboard framework
   detection. Without the secrets it skips with a notice. More: §7 of
   `docs/NETLIFY-DEPLOY.md`.

> `netlify.toml` values override dashboard settings for the same property, so
> leave Build command / Publish directory / Node version alone in the UI.

---

## 3. Environment variables

Set these in **Site configuration → Environment variables**.
All are server-side; none are exposed to the browser bundle.

| Variable | Required | Default behaviour when absent |
| --- | --- | --- |
| `DATABASE_URL` | **yes (production)** | `/api/health` returns **503 `database_unconfigured`** and every database-backed endpoint returns the same 503 with a message naming `DATABASE_URL`; pages that need no database (landing, `/builder`, exports of a supplied file) keep working. Nothing is written and no 500 with an empty body is produced |
| `DATABASE_SSL` | no | TLS auto-enabled when the URL contains `sslmode=require` or `ssl=true` |
| `DATABASE_POOL_MAX` | no | `3` in production, `10` in development |
| `SMS_PROVIDER_KEY` | only for phone login | Phone login is refused with HTTP 503 and nothing is written to the database |
| `SMS_PROVIDER` | no | `kavenegar` (default) or `http`; `kavenegar` also needs `SMS_OTP_TEMPLATE` |
| `SMS_PROVIDER_URL` / `SMS_PROVIDER_SENDER` | only for `SMS_PROVIDER=http` | delivery endpoint and sender line |
| `HERMIPLAN_ALLOW_DEMO_OTP` | **leave unset in production** | When unset together with `SMS_PROVIDER_KEY`, OTP codes are never returned in API responses |
| `HERMIPLAN_MARKET_FEED` | no | The dated reference rate catalogue is used and the UI states this explicitly |
| `HERMIPLAN_MARKET_FEED_KEY` | no | Bearer token for the rate feed |

**Important:** guest-first usage (project creation, analysis, exports) needs no
authentication and no login. Phone login is an optional convenience for
accessing projects from other devices.

`DATABASE_URL` must be available to **Functions** scope (the default). If you
scope variables to Builds only, requests will fail at runtime.

---

## 4. Production database and safe migrations

The schema lives in `src/db/schema.ts`; the versioned SQL lives in `drizzle/`
(`0001_baseline.sql`, `0002_security_hardening.sql`, `0003_share_tokens.sql`,
`0004_project_versions.sql`, each with a matching `*.rollback.sql`). They are applied by **`scripts/migrate.ts`**,
never during the site build, so a deploy cannot alter data automatically.

`0003_share_tokens` is **purely additive**: it creates the table
`project_share_tokens` (hashed share links) and touches no existing row. Until it
is applied, the `/s/<token>` route returns 404 — reports stay owner-only, which
is the safe direction.

`0004_project_versions` is also **purely additive**: it adds `projects.version`
(default 1) and the `project_versions` table. Existing projects are not
back-filled — their history starts with the first save after the deploy, so the
migration does not duplicate every stored project. Until it is applied the
application still works, but nothing is versioned.

Both have been rehearsed end-to-end on a real PostgreSQL 18.6 server rebuilt from
the previous release's schema (`docs/evidence/legacy-db.txt`: prepare → migrate
0001+0002+0003+0004 → 31 checks → rollback 0004+0003+0002 → 9 checks), and the
runner itself is covered by `npm run db:migration-safety`
(`docs/evidence/migration-safety.txt`: 31 checks incl. a full rollback → rebuild
rehearsal).

```bash
# 0. read-only preflight: pending migrations, drift, orphans, legacy links
DATABASE_URL="postgres://…" npm run db:preflight     # exit 1 = do not start

# 1. inspect what would run (no writes)
DATABASE_URL="postgres://…" npm run db:migrate -- --dry-run
DATABASE_URL="postgres://…" npm run db:status

# 2. take a backup
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql

# 3. apply (idempotent, in one transaction per migration)
DATABASE_URL="postgres://…" npm run db:migrate
```

How the runner protects you:

* a ledger table `_hermiplan_migrations` records the name, SHA-256 checksum and
  application time of every migration;
* editing an already-applied migration is refused (drift detection) — add a new
  file instead;
* each file runs inside a transaction, so a failure leaves the database
  unchanged;
* `--dry-run` prints the statements that would be executed.

**Rollback:** every migration ships with a paired `*.rollback.sql` that removes
exactly what it added. Apply the newest first
(`drizzle/0004_project_versions.rollback.sql`, then
`drizzle/0003_share_tokens.rollback.sql`, then
`drizzle/0002_security_hardening.rollback.sql`). Each rollback file deletes its
own `_hermiplan_migrations` row in the same transaction, so a later
`npm run db:migrate` re-applies it instead of silently believing the schema is
current. Dropping `project_share_tokens` invalidates every share link; projects,
their data and their ownership are untouched.

`drizzle/0001_baseline.rollback.sql` deletes **every** table and row. It refuses
to run unless you first create the confirmation table shown at the top of the
file:

```sql
CREATE TABLE "_hermiplan_rollback_baseline_ok" ();
```

That file empties the ledger too, so `db:migrate` rebuilds the schema from 0001.

All of the above is verified, not assumed: `npm run db:migration-safety` checks
that each migration has a rollback, that a second `db:migrate` is a no-op, that a
tampered checksum aborts the run, and — with
`MIGRATION_SAFETY_ROLLBACK=1` on a **disposable** database — that the baseline
rollback stays blocked without the confirmation table and that
rollback → `db:migrate` reproduces an identical schema. It also asserts that the
numbered rollbacks really remove what they added (`project_versions`,
`project_share_tokens`, `rate_limits`, `projects.version`) and that re-applying
them restores the column defaults — 31 checks in
`docs/evidence/migration-safety.txt`.

**Step-by-step production runbook:** `docs/RUNBOOK-PRODUCTION-MIGRATION.md`
(preflight → backup → migrate → deploy → verify → legacy-link communication →
rollback), with the expected output of every step.

The schema has no destructive statement: `0001` creates tables `IF NOT EXISTS`,
`0002`/`0003`/`0004` only add tables/columns/constraints/indexes. Nothing is dropped or
renamed, so an existing database deployed with `drizzle-kit push` keeps working
after `npm run db:migrate`.

Connection guidance:

* Each Netlify function instance is an isolated process with its own pool
  (`max` = `DATABASE_POOL_MAX`, default 3). With 20 concurrent requests you may
  open up to 60 connections — use a **pooled** endpoint or set
  `DATABASE_POOL_MAX=1`.
* `idleTimeoutMillis` is 10 s and idle-client errors are logged rather than
  thrown, so frozen serverless containers do not surface stale connections.

---

## 4b. Share links (`/s/<token>`) and the CSP

* Report sharing uses a 256-bit token (`crypto.randomBytes(32)`, base64url) whose
  **SHA-256 digest** is the only thing stored. Set `NEXT_PUBLIC_SITE_URL` to the
  public origin so a generated link never contains an internal bind address
  (`http://0.0.0.0:3000`) when the app runs behind a proxy or on serverless.
* `/report/<uuid>` is owner-only; a visitor without the cookie gets 404. Do not
  publish UUID-based links — they no longer work, by design.
* Revoking: `DELETE /api/projects/:id/share?tokenId=…`, all at once with
  `?all=1`, or implicitly by `PATCH { isPublic: false }`.
* At most **10 live links per project** (`409` beyond that); the count is done in
  SQL, so revoked links never creep the cap upwards. `last_used_at` /
  `use_count` are telemetry and are updated **at most once per minute per link**,
  so viewing a shared report is not a write amplification vector.
* **Legacy links (published before migration 0003):** a project with
  `is_public = true` and no token is *not* reachable — UUIDs are not credentials,
  so its old `/report/<uuid>` URL stops working. Nothing is backfilled and no
  token is invented for existing rows: backfilling would either store a token in
  plaintext or expose links the owner never issued. Run
  `DATABASE_URL=… npm run db:share-audit` **before** announcing the release to
  list the affected projects (read-only; `--json` for machines), then let each
  owner re-issue a link from the report panel. `db-integrity` §۴ and
  `docs/evidence/share-audit.txt` rehearse exactly this state.
* The report font is **self-hosted** (`public/fonts/Vazirmatn-variable.woff2`, SIL OFL):
  no request leaves the origin, so the policy allows no third-party
  `style-src`/`font-src` origin. If you replace the font, update
  `src/app/globals.css` **and** the embedded copy in `src/lib/report/html.ts`
  (the exported HTML embeds the font so it prints offline).
* Exports are reproducible: the archive timestamp of XLSX/ZIP comes from the
  project's status date, so exporting the same project twice yields identical
  bytes (safe to hash, cache or diff).
* The CSP is issued per request by `src/middleware.ts` with a nonce, so **do not**
  add a static `Content-Security-Policy` header in `next.config.ts` or at the CDN:
  it would conflict and drop the nonce. If you front the site with a CDN, make
  sure it passes response headers through unchanged. Verify after each deploy:
  `BASE_URL=https://your-domain npm run test:csp`.

---

## 5. OTP and authentication in production

* Codes are stored **hashed**, expire after **5 minutes**, allow **5 attempts**,
  and are invalidated afterwards.
* Rate limits are per endpoint and stored in PostgreSQL (`rate_limits`), so they
  are shared by every function instance: **12 auth requests / minute / IP**,
  **5 code requests / 15 min / phone**, **10 verifications / 15 min / phone and
  per IP**, **45 s between two codes for the same phone**. The full table lives
  in `README.md → Rate limits`.
* **Without `SMS_PROVIDER_KEY`:** login is refused with 503 and no code is
  returned — this is deliberate. To test login on a private preview you can set
  `HERMIPLAN_ALLOW_DEMO_OTP=1`, which returns the code in the response.
  **Never set this on a public production site.**
* Sessions are database-backed with an httpOnly `SameSite=Lax` cookie. Guest
  tokens are also httpOnly cookies. `SameSite=Lax` blocks cross-site POSTs, which
  is the CSRF protection for all mutating endpoints.
* Data isolation: raw project data (`GET/PATCH/DELETE /api/projects/:id`) is
  owner-only. Knowing the UUID is never authorisation: a non-owner always
  receives **404** (not 403) so the existence of a project is not disclosed.
* Reports are **private by default**. The owner publishes one explicitly from
  the report toolbar (optional expiry) and can revoke it at any time; every
  visibility change is written to `project_events` (`kind='visibility'`).
  Publishing a report does **not** grant access to the raw project API.

---

## 6. Deploy Previews vs production

Deploy Previews build identically (`[context.deploy-preview]` runs the same
command). Recommended:

* Create a **staging** database and set `DATABASE_URL` with scope
  *Deploy Previews* only, pointing at it.
* Keep production `DATABASE_URL` scoped to *Production*.
* `HERMIPLAN_ALLOW_DEMO_OTP=1` may be scoped to Deploy Previews for testing
  login safely.

---

## 7. Custom domain, HTTPS, DNS

1. **Site configuration → Domain management → Add a domain**.
2. Point DNS at Netlify (APEX `ALIAS`/`ANNS` → `<site>.netlify.app`, or `CNAME`
   for `www`).
3. HTTPS certificates are provisioned automatically; force HTTPS in
   *Domain management → HTTPS*.
4. No application change is required — no absolute URLs are hard-coded.

---

## 8. Post-deployment health checks

Run these against the production URL:

The fastest check is the script — it verifies config, the local build artifact
and the live deployment in one pass, and names the cause when something is off:

```bash
npm run deploy:check -- --url https://<site>.netlify.app     # exit 0 = healthy
```

The same checks by hand:

```bash
curl -s https://<site>/api/health
# {"ok":true,"schemaVersion":5,"database":"ok","rateLimitStore":"postgres",
#  "shareLinks":"postgres","smsConfigured":false}
# 503 with "missingTables" means the migrations were not applied yet.
# 503 "database_unconfigured" means DATABASE_URL is missing for Functions scope.
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/BUILD_ID   # must be 404
# 200 here means the raw build output is being served statically: the adapter
# never ran, and every route will 404. See docs/NETLIFY-DEPLOY.md.
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/builder     # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/report/xxx  # 404
curl -sI https://<site>/ | grep -iE 'x-frame-options|x-content-type-options'
```

Then, in a browser: create a guest project → refresh the page (draft restores)
→ **تولید گزارش** → open the report → download each export format → print to
PDF. Finally verify isolation: a different browser (no cookies) must get **404**
from `/api/projects/<id>`, and also 404 from `/report/<id>` unless the owner has
explicitly published it.

---

## 9. Common failures and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Build fails: `DATABASE_URL is required` | older revision; the module used to throw at import time | pull the current code — the pool is now created lazily |
| Build succeeds, site loads, every project request returns 500 | `DATABASE_URL` missing or scoped to Builds only | add it with Functions scope, redeploy |
| `too many connections` from Postgres | unpooled connection string × concurrent functions | use the provider's pooled endpoint or set `DATABASE_POOL_MAX=1` |
| `no pg_hba.conf entry for host … SSL off` | provider requires TLS | set `DATABASE_SSL=require` or add `?sslmode=require` |
| Login always returns 503 | no `SMS_PROVIDER_KEY` | configure a provider, or accept that login is unavailable (guest usage still works) |
| Exports return 429 | per-IP export limit (30/min) reached | expected behaviour; retry after the `Retry-After` interval |
| Report page 404 for a stranger | reports are private until the owner publishes them (or the share link expired) | intended behaviour |
| Deploy Preview cannot reach the database | preview scoped to a staging DB that does not exist | point it at a reachable database or remove the scope |
| Every URL shows Netlify's **"Page not found"**, while the build log says success | the deploy published the raw `.next` output and Netlify's Next.js runtime never ran (no function, no routing) — usually a `--dir` deploy or an adapter that was not attached | confirm with `npm run deploy:check -- --url https://…` (`raw_next_publish`); then redeploy from Git or `netlify deploy --build --prod`, and confirm `/BUILD_ID` returns **404** afterwards. Full checklist: `docs/NETLIFY-DEPLOY.md` |
| App answers 503 `database_unconfigured` | `DATABASE_URL` is not set for **Functions** scope | add it in the UI and redeploy; this is a deliberate, explicit failure (see §3) |

**Rollback:** *Deploys → select the last known-good deploy → … → Publish deploy*.
Database schema changes are not reverted by a code rollback: apply the paired
`drizzle/<name>.rollback.sql` (see §4) after reviewing it, or restore the backup
taken before the migration.

---

## 10. Not available until configured

| Feature | Needs |
| --- | --- |
| Phone login / OTP by SMS | `SMS_PROVIDER_KEY` |
| Cross-device project access | phone login (guest projects are claimed on first login) |
| Live market rates | `HERMIPLAN_MARKET_FEED` |
| Deploy Previews with data | a staging `DATABASE_URL` |

Everything else — guest project creation, the calculation engine, all seven
export formats, Gantt, reports, private/public sharing — works with only
`DATABASE_URL` set.

---

## 11. Runtime limits to be aware of

* Synchronous Netlify functions: **10 s default / 26 s** on higher plans. The
  heaviest operation measured is a 200-activity analysis plus full ZIP package:
  **~77 ms**, well inside the limit.
* Function request/response payload: **6 MB**. The app rejects request bodies
  above **3 MB** with 413, and a 200-activity export package is **~1.2 MB**.
* All exports are generated in memory — no filesystem writes, which is required
  because function filesystems are read-only.
* Rate limiting is backed by PostgreSQL (`rate_limits`, atomic upsert), so the
  quota is global across function instances and regions. If the database is
  unreachable the limiter degrades to an in-process counter and marks the
  decision `degraded` — it never fails open, and it never pretends to be
  global.
