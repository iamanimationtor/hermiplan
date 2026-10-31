# شواهد اجرا (raw evidence)

این پوشه خروجی **خام** فرمان‌هایی است که در تاریخ ۲۰۲۶-۱۰-۳۱ (UTC) در همین مخزن اجرا شده‌اند.
هیچ فایلی دست‌کاری نشده و عددی دستی وارد نشده است؛ هر فایل، متن stdout/stderr همان فرمان است.

| فایل | فرمان | انتظار |
| --- | --- | --- |
| `npm-ci.txt` | `npm ci --no-audit --no-fund` | نصب دقیق از `package-lock.json` بدون خطا |
| `typecheck.txt` | `npx tsc --noEmit` | `EXIT=0` |
| `lint.txt` | `npx eslint . -f json` | ۸۶ فایل · `errors 0 warnings 0` |
| `tests.txt` | `npm test` | **۸ مجموعه** سبز، `EXIT=0` — هیچ سرور/دیتابیسی لازم نیست |
| `build.txt` | `npm run build` | `✓ Compiled successfully` |
| `real-postgres.txt` | `db:status` + `select version()` | PostgreSQL واقعی، سه مهاجرت اعمال‌شده |
| `api-integration.txt` | `npm run test:api` روی build تولیدی + PostgreSQL واقعی | **۸۱ موفق / ۰ ناموفق / ۶ نادیده** (۶ نادیده = مسیر OTP که در production بسته است) |
| `api-integration-otp.txt` | همان، روی `next dev` با `HERMIPLAN_ALLOW_DEMO_OTP=1` | **۸۶ موفق / ۰ ناموفق / ۰ نادیده** |
| `legacy-db.txt` | چرخه کامل روی پایگاه نسخه قبل (PostgreSQL واقعی) | prepare ۲ · verify **۲۵** · rollback · verify-rollback **۶** |
| `csp.txt` | `npm run test:csp` | هدر CSP، nonce، منابع مجاز |
| `layout.txt` | `npm run test:layout` | رندر پیکسلی نمودار، قواعد چاپ، پیش‌شرط‌های موبایل |
| `db-integrity.txt` | `npm run test:db:integrity` | **۱۴ بررسی**: هم‌زمانی ۴۰ اتصال، یکتایی هش، CASCADE، `VALIDATE CONSTRAINT`، سازگاری لینک قدیمی |
| `load.txt` | `npm run test:load` (۳۰ ثانیه، هم‌زمانی ۲۴) | ۱۰٬۶۷۹ درخواست، ۰ خطا؛ تحلیل ۲۳۲٫۸ rps (p95 ۱۴۲ms)، SSR ۱۲۳٫۲ rps — ظرفیت محلی، نه Netlify |
| `production-smoke.txt` | `next start` + `curl` | health، کدهای ۲۰۰/۴۰۴، `robots.txt`، هدرهای امنیتی، فونت خودمیزبان |
| `api-integration-review.txt` | `test:api` پس از بازبینی نهایی | **۸۰ موفق / ۰ ناموفق / ۶ نادیده** (۱۸ بررسی تازه: انقضا، ابطال مستقل، سقف ۱۰ لینک، CSRF، افشا) |
| `csp-review.txt` | `test:csp` با مسیرهای واقعی (`share-fixture.ts`: کوکی مالک + لینک زنده/باطل/ناشناس + UUID بیگانه) | **۹۲ بررسی** روی ۷ مسیر واقعی |
| `db-integrity-review.txt` | `test:db:integrity` | **۱۴ بررسی** (شامل §۴ پروژه «منتشرشده پیش از ۰۰۰۳») |
| `health-probe.txt` | `curl` روی پایگاهی که مهاجرت نشده است | ۵۰۳ + `missingTables`؛ پس از `db:migrate` ⇒ ۲۰۰ |
| `migration-review.txt` | اجرای دوباره `db:migrate` و دست‌کاری checksum | بیکار بودن اجرای دوباره و رد شدن drift |
| `share-audit.txt` | `npm run db:share-audit` | فهرست لینک‌های فعال و علامت‌خوردن پروژه «منتشرشده پیش از مهاجرت» |
| `migration-safety.txt` | `npm run db:migration-safety` (با `MIGRATION_SAFETY_ROLLBACK=1`) | **۲۵ بررسی**: جفت بازگشت هر مهاجرت، no-op بودن اجرای دوم، رد شدن drift، قفل بازگشت پایه، بازگشت کامل و بازسازی هم‌ساختار |
| `preflight.txt` | `npm run db:preflight` (+ `--json`) | پیش‌بررسی فقط‌خواندنی: مهاجرت‌های در انتظار، drift، یتیم مالکیت، لینک قدیمی، حجم |
| `export.txt` | `npm run test:export` (با `BASE_URL`) | **۶۱ بررسی** روی XLSX/CSV/HTML/بسته/MSProject + PDF-چاپی از سرویس |
| `a11y.txt` | `npm run test:a11y` | **۳۲ بررسی** روی HTML سرو‌شده (زبان، جهت، landmark،‏ h1، برچسب ورودی‌ها، alt) |
| `bundle.txt` | `npm run test:bundle` | بودجه‌ی gzip هر مسیر؛ سنگین‌ترین `/builder` با ۱۷۵٫۴KB |

## بازتولید

```bash
# ۱. نصب دقیق و بررسی ایستا (۸۶ فایل)
npm ci
npx tsc --noEmit
npx eslint . -f json
npm test
npm run build

# ۲. PostgreSQL واقعی (بدون root، بدون Docker)
npx tsx scripts/pg-dev-server.ts &          # 127.0.0.1:5544
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5544/postgres
npm run db:migrate

# ۳. سرور تولیدی + مجموعه یکپارچگی و مرور «مسیر واقعی»
npx next start -p 3400 &
BASE_URL=http://127.0.0.1:3400 npm run test:api
BASE_URL=http://127.0.0.1:3400 npm run test:csp
BASE_URL=http://127.0.0.1:3400 npm run test:a11y
BASE_URL=http://127.0.0.1:3400 npm run test:export
npm run test:bundle                        # بودجه JS هر مسیر (نیازمند build)

# ۳ب. مسیر OTP روی سرور توسعه (دمای آزمایشی فقط خارج از production)
HERMIPLAN_ALLOW_DEMO_OTP=1 npx next dev -p 3500 &
BASE_URL=http://127.0.0.1:3500 npm run test:api   # ۸۶/۰/۰

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
BASE_URL=http://127.0.0.1:3600 npm run test:load   # سرور با سقف نرخ بالا برای سنجش ظرفیت

# ۷. بازبینی وضعیت پیش از مهاجرت/انتشار
DATABASE_URL=… npm run db:preflight
DATABASE_URL=… npm run db:share-audit
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
