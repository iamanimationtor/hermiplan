# HERMIPLAN — Netlify Deployment

This guide matches the actual implementation. It assumes Next.js 16 (App Router,
Turbopack), PostgreSQL via Drizzle ORM, and Netlify's automatically installed
OpenNext Next.js adapter.

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
3. The Next.js Runtime (the OpenNext-based adapter, `@netlify/plugin-nextjs`)
   is declared **explicitly in the repo**: `[[plugins]]` in `netlify.toml` +
   pinned in `package.json` / `package-lock.json`. It therefore runs on every
   deploy — production, branch deploys and Deploy Previews — regardless of
   Netlify's framework auto-detection.
   **Do not remove this declaration.** Relying on auto-detection alone is what
   caused deploys where the build succeeded but every route (including `/`)
   returned Netlify's "Page not found": without the runtime, the raw `.next`
   output is published as plain static files — no `index.html` at its root,
   no server function to render routes. In the deploy log, confirm the line
   `Using Next.js Runtime` and the `Functions bundling` step that packages
   `___netlify-server-handler`.
4. Build settings come from `netlify.toml` (already committed):
   `command = "npm run build"`, `publish = ".next"`, `NODE_VERSION = "22"`
   (also pinned in `.nvmrc`). `package-lock.json` is committed, so Netlify's
   `npm install` is reproducible and installs the pinned runtime version.

> `netlify.toml` values override dashboard settings for the same property, so
> leave Build command / Publish directory / Node version alone in the UI.

---

## 3. Environment variables

Set these in **Site configuration → Environment variables**.
All are server-side; none are exposed to the browser bundle.

| Variable | Required | Default behaviour when absent |
| --- | --- | --- |
| `DATABASE_URL` | **yes (production)** | Requests that touch the database return a clear 500 error; the site still builds and renders public pages |
| `DATABASE_SSL` | no | TLS auto-enabled when the URL contains `sslmode=require` or `ssl=true` |
| `DATABASE_POOL_MAX` | no | `3` in production, `10` in development |
| `SMS_PROVIDER_KEY` | only for phone login | Phone login is refused with HTTP 503 (`loginUnavailable`) |
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

The schema lives in `src/db/schema.ts` and is applied with `drizzle-kit`.
Migrations are **never** run during the site build, so a deploy cannot alter
data automatically.

First-time setup (creates `projects`, `users`, `otp_codes`, `sessions`,
`project_events`):

```bash
DATABASE_URL="postgres://…pooled…" npx drizzle-kit push
```

Subsequent schema changes: re-run the same command. `drizzle-kit push` compares
the schema with the live database and emits the exact DDL it will run — review
it before confirming. `--force` skips the prompt; use it only after reading the
diff. For anything that could drop columns, prefer a backup first:

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
```

Connection guidance:

* Each Netlify function instance is an isolated process with its own pool
  (`max` = `DATABASE_POOL_MAX`, default 3). With 20 concurrent requests you may
  open up to 60 connections — use a **pooled** endpoint or set
  `DATABASE_POOL_MAX=1`.
* `idleTimeoutMillis` is 10 s and idle-client errors are logged rather than
  thrown, so frozen serverless containers do not surface stale connections.

---

## 5. OTP and authentication in production

* Codes are stored **hashed**, expire after **5 minutes**, allow **5 attempts**,
  and are invalidated afterwards.
* Rate limits: **12 auth requests / minute / IP** and **45 s between codes for
  the same phone number**.
* **Without `SMS_PROVIDER_KEY`:** login is refused with 503 and no code is
  returned — this is deliberate. To test login on a private preview you can set
  `HERMIPLAN_ALLOW_DEMO_OTP=1`, which returns the code in the response.
  **Never set this on a public production site.**
* Sessions are database-backed with an httpOnly `SameSite=Lax` cookie. Guest
  tokens are also httpOnly cookies. `SameSite=Lax` blocks cross-site POSTs, which
  is the CSRF protection for all mutating endpoints.
* Data isolation: raw project data (`GET/PATCH/DELETE /api/projects/:id`) is
  owner-only. The report **page** is shareable by design, and an owner can make
  it private with the 🔒 toggle in the report toolbar.

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

```bash
curl -s https://<site>/api/health                 # {"ok":true}
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/builder     # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<site>/report/xxx  # 404
curl -sI https://<site>/ | grep -iE 'x-frame-options|x-content-type-options'
```

Then, in a browser: create a guest project → refresh the page (draft restores)
→ **تولید گزارش** → open the report → download each export format → print to
PDF. Finally verify isolation: a different browser (no cookies) must get 403
from `/api/projects/<id>` while still seeing the public report page.

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
| Report page 404 for a stranger | the owner set the report to private | intended behaviour |
| Deploy Preview cannot reach the database | preview scoped to a staging DB that does not exist | point it at a reachable database or remove the scope |

**Rollback:** *Deploys → select the last known-good deploy → … → Publish deploy*.
Database schema changes are not reverted by a code rollback — run the matching
`drizzle-kit push` against a backup if a migration must be undone.

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
* Rate limiting is per function instance, not global. For a single Netlify
  function region this is adequate for abuse prevention; if you scale out or
  need strict global limits, move the counters to a shared store (e.g. Upstash
  Redis) — the call sites in `src/lib/server/rate-limit.ts` are isolated for
  exactly that change.
