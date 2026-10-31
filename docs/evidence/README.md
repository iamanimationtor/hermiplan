# شواهد اجرا (raw evidence)

این پوشه خروجی **خام** فرمان‌هایی است که در تاریخ ۲۰۲۶-۱۰-۳۱ (UTC) در همین مخزن اجرا شده‌اند.
هیچ فایلی دست‌کاری نشده و عددی دستی وارد نشده است؛ هر فایل، متن stdout/stderr همان فرمان است.

| فایل | فرمان | انتظار |
| --- | --- | --- |
| `npm-ci.txt` | `npm ci --no-audit --no-fund` | نصب دقیق از `package-lock.json` بدون خطا |
| `typecheck.txt` | `npx tsc --noEmit` | `EXIT=0` |
| `lint.txt` | `npx eslint . -f json` | ۸۶ فایل · `errors 0 warnings 0` |
| `tests.txt` | `npm test` | **۱۲ مجموعه** سبز، `EXIT=0` — هیچ سرور/دیتابیسی لازم نیست |
| `build.txt` | `npm run build` | `✓ Compiled successfully` |
| `real-postgres.txt` | `db:status` + `select version()` | PostgreSQL واقعی ۱۸٫۶، هر پنج مهاجرت اعمال‌شده |
| `api-integration.txt` | `npm run test:api` روی build تولیدی + PostgreSQL واقعی، حالت `locked` | **۲۲۳ موفق / ۰ ناموفق / ۶ نادیده** (۶ نادیده = مسیر OTP که در production بسته است) |
| `api-integration-open.txt` | همان build با `HERMIPLAN_ACCESS_MODE=open` روی `:3410` | **۲۲۱ موفق / ۰ ناموفق / ۷ نادیده** — سهمیه‌های محصول برداشته شده (۲۰۱ به‌جای ۴۰۹ برای لینک یازدهم، بدون ۴۲۹) |
| `password.txt` | `npm run test:password` (خالص) | **۴۵ بررسی**: هش scrypt، نمک، هش خراب، سیاست رمز، نرمال‌سازی/یکتایی نام کاربری |
| `journey.txt` | `npm run test:journey` (روی build تولیدی) | **۷۹ بررسی**: ثبت‌نام → تعریف پروژه → ویرایش → باز کردن واقعی هر ۷ خروجی (XLSX پارس‌شده، CSV، MSPDI، سند چاپی، ZIP) → اشتراک → حذف |
| `access-mode.txt` | `npm run access:status` + `npm run test:access` + `/api/health` و نشان سازنده در هر دو حالت | **۵۲ بررسی**؛ `locked` از `config/access.json` (سقف ۱۰، تاریخچه ۲۰/۸MB) و همان build با `HERMIPLAN_ACCESS_MODE=open` ⇒ `source:"env"`، سقف ۱۰۰٬۰۰۰، تاریخچه ۱۰۰/۳۲MB؛ نشان «بدون سهمیه» فقط در `open` |
| `api-integration-otp.txt` | همان، روی `next dev` با `HERMIPLAN_ALLOW_DEMO_OTP=1` | **۲۲۸ موفق / ۰ ناموفق / ۰ نادیده** (شامل ۶ سناریوی OTP و ۲۵ سناریوی نام کاربری/رمز) |
| `versions.txt` | برش بخش‌های تاریخچه، مقایسه و اعتبارسنجی پارامترها از `npm run test:api` | **۷۵ بررسی** (۴۲ + ۱۴ + ۱۹): ایجاد، ذخیره، ذخیره تکراری، ۴۰۹، بازگردانی، هرس، مسابقه دو نویسنده، بازسازی نسخه گمشده، تفاوت نسخه‌ها و ۴۰۴ مقایسه |
| `version-diff.txt` | `npm run test:versions` (خالص، بدون سرور) | **۴۱ بررسی** تفاوت نسخه‌ها |
| `legacy-db.txt` | چرخه کامل روی پایگاه نسخه قبل (PostgreSQL واقعی) | prepare ۲ · migrate `0001`–`0005` · verify **۳۱** · rollback · verify-rollback **۹** |
| `otp-sms.txt` | `npm run test:otp` (ارائه‌دهنده‌ی ساختگی محلی + PostgreSQL واقعی) | **۳۹ بررسی**: پیکربندی ناقص، قرارداد HTTP ارائه‌دهنده، فقط-هش ذخیره شدن کد، یک‌بارمصرف بودن، مهلت ارسال مجدد، و ۵۰۲ در قطع ارائه‌دهنده بدون باقی‌ماندن کد |
| `csp.txt` | `npm run test:csp` | هدر CSP، nonce، منابع مجاز |
| `layout.txt` | `npm run test:layout` | رندر پیکسلی نمودار، قواعد چاپ، پیش‌شرط‌های موبایل |
| `db-integrity.txt` | `npm run test:db:integrity` | **۲۰ بررسی**: هم‌زمانی محدودیت نرخ، یکتایی هش، CASCADE، `VALIDATE CONSTRAINT`، سازگاری لینک قدیمی، **یکتایی نسخه + ۲۴ نویسنده هم‌زمان + آبشار تاریخچه** |
| `load.txt` | `npm run test:load` (۸ ثانیه، هم‌زمانی ۱۲، با سهمیه‌های بالا فقط برای همین سنجش) | ۲٬۳۷۵ درخواست، ۰ خطا؛ تحلیل ۱۸۴٫۶ rps (p95 ۸۹٫۹ms)، SSR ۱۱۲٫۳ rps (p95 ۱۴۰٫۲ms) — ظرفیت محلی، نه Netlify |
| `production-smoke.txt` | `next start` + `curl` | health (`schemaVersion:5`, `access.mode:"locked"`)، صفحه‌های ۲۰۰، ثبت‌نام/ورود با نام کاربری (۲۰۱/۴۰۱/۲۰۰)، رد Origin بیگانه (۴۰۳)، پیامک بدون کلید (۵۰۳)، هدرهای امنیتی |
| `api-integration-review.txt` | خلاصه اجراهای `test:api` (build تولیدی `locked`/`open` و dev) | **۲۲۳/۰/۶**، **۲۲۱/۰/۷** و **۲۲۸/۰/۰** — شامل انقضا، ابطال مستقل، سقف ۱۰ لینک، CSRF، افشا، لینک قدیمی، CASCADE، **تاریخچه/بازگردانی/مقایسه/اعتبارسنجی/۴۰۹** |
| `csp-review.txt` | `test:csp` با مسیرهای واقعی (`share-fixture.ts`: کوکی مالک + لینک زنده/باطل/ناشناس + UUID بیگانه) | **۹۲ بررسی** روی ۷ مسیر واقعی (بازتولید در همین دور) |
| `csp-real-routes.txt` | `BASE_URL=… bash scripts/csp-real-routes.sh` | **۷۸ بررسی** روی ۶ مسیر واقعی: `/`, `/builder`, `/report/<uuid>` با کوکی مالک، لینک زندهٔ اشتراک، و دو مسیر ۴۰۴ — شامل nonce یکتا، بدون `unsafe-inline`، و عدم افشای توکن با Referrer |
| `db-integrity-review.txt` | `test:db:integrity` — اجرای قدیمی‌تر | **۱۴ بررسی**؛ نسخه کامل‌تر و جاری: `db-integrity.txt` (۲۰ بررسی) |
| `health-probe.txt` | `curl /api/health` در سه وضعیت (locked، open با env، پایگاه بدون مهاجرت / فقط تا ۰۰۰۴) + کد وضعیت مسیرها | ۲۰۰ + `schemaVersion:5` + `access`؛ پایگاه خالی ⇒ ۵۰۳ + `missingTables`؛ پایگاه تا ۰۰۰۴ ⇒ ۵۰۳ + `missingColumns`؛ مسیرهای ۴۰۴ متن راهنما دارند |
| `migration-review.txt` | اجرای دوباره `db:migrate` و دست‌کاری checksum | بیکار بودن اجرای دوباره و رد شدن drift |
| `share-audit.txt` | `npm run db:share-audit` | فهرست لینک‌های فعال و علامت‌خوردن پروژه «منتشرشده پیش از مهاجرت» |
| `migration-safety.txt` | `npm run db:migration-safety` (با `MIGRATION_SAFETY_ROLLBACK=1`) | **۴۵ بررسی**: جفت بازگشت هر مهاجرت، no-op بودن اجرای دوم، رد شدن drift، قفل بازگشت پایه، بازگشت کامل و بازسازی هم‌ساختار، و §۸ = تشخیص پایگاه مهاجرت‌نشده (`isSchemaError`) |
| `preflight.txt` | `npm run db:preflight` (+ `--json`) | پیش‌بررسی فقط‌خواندنی: مهاجرت‌های در انتظار، drift، یتیم مالکیت، لینک قدیمی، حجم |
| `export.txt` | `npm run test:export` (با `BASE_URL`) | **۸۰ بررسی** روی XLSX/CSV/HTML/بسته/MSProject + امضای بایتی هر ۷ فرمت سرویس‌شده + **اعتبار ساختار Workbook** (`row` استاندارد، rels، content-types، autoFilter، قالب عددی) |
| `a11y.txt` | `npm run test:a11y` | **۳۲ بررسی** روی HTML سرو‌شده (زبان، جهت، landmark،‏ h1، برچسب ورودی‌ها، alt) |
| `bundle.txt` | `npm run test:bundle` | بودجه‌ی gzip هر مسیر؛ سنگین‌ترین `/builder` با ۱۷۵٫۹KB |
| `project-file.txt` | `npm run test:project-file` | **۳۱ بررسی**: رفت‌وبرگشت کامل داده، رد فایل خراب/بی‌پروژه/نسخهٔ آینده، پاک‌سازی بخش‌های ناشناخته |
| `final-checks.txt` | a11y + export + layout + versions + project-file + bundle + csp-real + access در یک اجرا | ۳۲ · ۸۰ · ۲۴ · ۴۱ · ۳۱ · ۶/۶ · ۷۸ · ۵۲ — همه سبز |
| `security.txt` | `npm run test:security` | **۲۹۱ بررسی** (شماره، OTP، CSRF، محدودیت نرخ، توکن اشتراک، قاعده‌های خالص تاریخچه) |

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
