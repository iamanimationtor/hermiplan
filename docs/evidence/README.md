# شواهد اجرا (raw evidence)

این پوشه خروجی **خام** فرمان‌هایی است که در تاریخ ۲۰۲۶-۱۰-۳۱ (UTC) در همین مخزن اجرا شده‌اند.
هیچ فایلی دست‌کاری نشده و عددی دستی وارد نشده است؛ هر فایل، متن stdout/stderr همان فرمان است.

| فایل | فرمان | انتظار |
| --- | --- | --- |
| `npm-ci.txt` | `npm ci --no-audit --no-fund` | نصب دقیق از `package-lock.json` بدون خطا |
| `typecheck.txt` | `npx tsc --noEmit` | `EXIT=0` |
| `lint.txt` | `npx eslint . -f json` | `errors 0 warnings 0` |
| `tests.txt` | `npm test` | ۷ مجموعه سبز، `EXIT=0` |
| `build.txt` | `npm run build` | `✓ Compiled successfully` |
| `real-postgres.txt` | `db:status` + `select version()` | PostgreSQL واقعی، سه مهاجرت اعمال‌شده |
| `api-integration.txt` | `npm run test:api` روی build تولیدی | ۶۲ موفق / ۰ ناموفق / ۶ نادیده (مسیر OTP در production بسته است) |
| `api-integration-otp.txt` | همان، با `HERMIPLAN_ALLOW_DEMO_OTP=1` | ۶۷ موفق / ۰ ناموفق / ۰ نادیده |
| `legacy-db.txt` | `db:migrate` + `legacy-db-check` روی پایگاه نسخه قبل | مهاجرت ۲۵ بررسی، rollback ۶ بررسی |
| `csp.txt` | `npm run test:csp` | هدر CSP، nonce، منابع مجاز |
| `layout.txt` | `npm run test:layout` | رندر پیکسلی نمودار، قواعد چاپ، پیش‌شرط‌های موبایل |
| `db-integrity.txt` | `npm run test:db:integrity` | هم‌زمانی ۴۰ اتصال، قیدها، `VALIDATE CONSTRAINT` |
| `load.txt` | `npm run test:load` | p50/p95/p99 و نرخ خطا |
| `production-smoke.txt` | `next start` + `curl` | health، کدهای ۲۰۰/۴۰۴، هدرهای امنیتی |

## بازتولید

```bash
# ۱. نصب دقیق و بررسی ایستا
npm ci
npx tsc --noEmit
npx eslint . -f json
npm test
npm run build

# ۲. PostgreSQL واقعی (بدون root، بدون Docker)
npx tsx scripts/pg-dev-server.ts &          # 127.0.0.1:5544
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5544/postgres
npm run db:migrate

# ۳. سرور تولیدی + مجموعه یکپارچگی
npx next start -p 3400 &
BASE_URL=http://127.0.0.1:3400 npm run test:api
BASE_URL=http://127.0.0.1:3400 npm run test:csp

# ۴. هم‌زمانی و قیدها (پایگاه دورانداختنی)
psql -c 'CREATE DATABASE hermiplan_conc' "$DATABASE_URL"   # یا هر روش ساخت پایگاه
DATABASE_URL=…/hermiplan_conc npm run db:migrate
DATABASE_URL=…/hermiplan_conc npm run test:db:integrity

# ۵. سناریوی پایگاه نسخه قبل (پایگاه دورانداختنی جدا)
DATABASE_URL=…/hermiplan_legacy npx tsx scripts/legacy-db-check.ts prepare
DATABASE_URL=…/hermiplan_legacy npm run db:migrate
DATABASE_URL=…/hermiplan_legacy npx tsx scripts/legacy-db-check.ts verify
DATABASE_URL=…/hermiplan_legacy npx tsx scripts/legacy-db-check.ts rollback
DATABASE_URL=…/hermiplan_legacy npx tsx scripts/legacy-db-check.ts verify-rollback

# ۶. چیدمان و بار
npm run test:layout
BASE_URL=http://127.0.0.1:3400 npm run test:load
```

## محیط اجرا

- Node.js 22، Next.js 16.2.6، **PostgreSQL 18.6 واقعی** (باینری `embedded-postgres` به‌عنوان
  devDependency؛ نه Docker، نه root). پیش از این دور، آزمون‌ها روی PGlite (پروتکل PostgreSQL) بود.
- `HERMIPLAN_ALLOW_DEMO_OTP=1` فقط در `next dev` استفاده شد تا مسیر ورود آزموده شود؛ سرور
  `next start` (production) بدون این متغیر اجرا شد و ورود را ۵۰۳ رد کرد.
- آزمون بار روی نمونه‌ای اجرا شد که در آن **فقط برای همین سنجش** سهمیه `RATE_LIMIT_ANALYZE`
  بالا برده شده بود تا ظرفیت موتور دیده شود، نه سقف محدودکننده؛ خود محدودکننده در
  `api-integration` §۹ و `db-integrity` §۱ سنجیده می‌شود.
- آزمون مرورگری (اسکرین‌شات/PDF واقعی) اجرا نشده است: باینری Chromium به `libnspr4`، `libnss3` و
  چند کتابخانه سیستمی دیگر نیاز دارد و نصبشان root + مخزن Debian می‌خواهد. جای آن،
  `layout.txt` رندر پیکسلی نمودار و قواعد چاپ را می‌سنجد.
