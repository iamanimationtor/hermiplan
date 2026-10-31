# شواهد اجرا (raw evidence)

این پوشه خروجی **خام** فرمان‌هایی است که در تاریخ ۲۰۲۶-۱۰-۳۱ (UTC) در همین مخزن اجرا شده‌اند.
هیچ فایلی دست‌کاری نشده و عددی دستی وارد نشده است؛ هر فایل، متن stdout/stderr همان فرمان است.

| فایل | فرمان | انتظار |
| --- | --- | --- |
| `npm-ci.txt` | `npm ci --no-audit --no-fund` | نصب دقیق از `package-lock.json` بدون خطا |
| `typecheck.txt` | `npx tsc --noEmit` | `EXIT=0` |
| `lint.txt` | `npx eslint . -f json` | `errors 0 warnings 0` |
| `tests.txt` | `npm test` | ۷ مجموعه سبز، `EXIT=0` |
| `api-integration.txt` | `npm run test:api` (سرور + PostgreSQL محلی) | `51 موفق / 0 ناموفق` |
| `build.txt` | `npm run build` | `✓ Compiled successfully` |
| `legacy-db.txt` | `db:migrate` + `legacy-db-check` روی پایگاه نسخه قبل | مهاجرت ۲۱ بررسی، rollback ۵ بررسی، اعمال مجدد |
| `production-smoke.txt` | `next start` + `curl` | health ok، ۴۰۴ برای گزارش ناشناس، ۵۰۳ برای ورود بدون پیامک، هدرهای امنیتی |

## بازتولید

```bash
# ۱. نصب دقیق
npm ci

# ۲. بررسی ایستا و آزمون‌های بدون پایگاه داده
npx tsc --noEmit
npx eslint . -f json
npm test

# ۳. ساخت
npm run build

# ۴. آزمون یکپارچگی (نیازمند پایگاه داده مهاجرت‌شده و سرور در حال اجرا)
DATABASE_URL="postgresql://…" npm run db:migrate
DATABASE_URL="postgresql://…" HERMIPLAN_ALLOW_DEMO_OTP=1 npx next dev -p 3100 -H 0.0.0.0 &
DATABASE_URL="postgresql://…" BASE_URL=http://127.0.0.1:3100 npm run test:api

# ۵. سناریوی پایگاه داده نسخه قبل (فقط روی پایگاه دورانداختنی)
DATABASE_URL="postgresql://…" npx tsx scripts/legacy-db-check.ts prepare
DATABASE_URL="postgresql://…" npm run db:migrate
DATABASE_URL="postgresql://…" npx tsx scripts/legacy-db-check.ts verify
```

## محیط اجرا

- Node.js 22، Next.js 16.2.6، PostgreSQL-compatible engine: **PGlite** روی سوکت TCP محلی
  (پروتکل PostgreSQL)، نه سرور PostgreSQL نصب‌شده. این تفاوت در
  `docs/PROMPT-COMPLIANCE.md` §۳-۴ به‌عنوان محدودیت صریح ثبت شده است.
- `HERMIPLAN_ALLOW_DEMO_OTP=1` فقط برای `next dev` استفاده شد تا مسیر ورود آزموده شود؛
  سرور `next start` (production) بدون این متغیر اجرا شد و ورود را ۵۰۳ رد کرد.
