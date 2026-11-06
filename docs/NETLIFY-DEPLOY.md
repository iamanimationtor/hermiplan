# استقرار روی Netlify — تشخیص، تنظیمات درست و چک‌لیست

این سند مخصوص همان خطایی است که در تاریخ ۲۰۲۶-۱۱-۰۶ روی
`https://hermiplan.netlify.app` دیده شد:

> **Page not found** — «Looks like you’ve followed a broken link or entered a URL
> that doesn’t exist on this site.»

و بعد از آن، هر بار که یک تغییر در بیلد یا تنظیمات Netlify انجام شد، همین سند
مرجع تأیید است.

---

## ۱. علت ریشه‌ای (با شاهد، نه حدس)

سه سنجش زنده روی همان دامنه انجام شد:

| آدرس | پاسخ | معنا |
| --- | --- | --- |
| `/` | ۴۰۴ + صفحهٔ «Page not found» خودِ Netlify | هیچ مسیری وجود ندارد که پاسخ بدهد |
| `/BUILD_ID` | **۲۰۰** + مقدار `07MAeMBJT2t_HEmwi5F17` | خروجی بیلد Next در ریشهٔ سایت به‌صورت فایل خام منتشر شده است |
| `/app-path-routes-manifest.json` | **۲۰۰** + مانیفست کامل مسیرها (`/`، `/builder`، `/api/*` …) | همان: پوشهٔ `.next` عیناً به‌عنوان سایت استاتیک سرو می‌شود |

و برای اطمینان از اینکه دامنه «وجود دارد»: یک زیردامنهٔ ناموجود
(`zzq-nonexistent-site-98765.netlify.app`) صفحهٔ **«Site not found»** می‌دهد،
در حالی که دامنهٔ ما **«Page not found»** می‌دهد. یعنی سایت هست، دیپلوی هم
«موفق» بوده، ولی چیزی که منتشر شده **خروجی خام `next build`** است.

آن خروجی هیچ `index.html` و هیچ تابعی ندارد؛ فقط `BUILD_ID`، مانیفست‌ها و
چانک‌های سرور دارد. `next build` به‌تنهایی هرگز نمی‌تواند این اپ را سرو کند:
چیزی که `.next` را به یک تابع سرورلس + جدول مسیر تبدیل می‌کند،
**Netlify Next.js runtime** است (`@netlify/plugin-nextjs`، آداپتر OpenNext).
در آن دیپلوی، این آداپتر اجرا نشده بود.

دو راه برای رسیدن به این حالت وجود دارد و هر دو یک نتیجه دارند:

1. آداپتر به بیلد وصل نیست (تشخیص فریم‌ورک غیرفعال، یا پریست فریم‌ورک روی
   چیزی غیر از Next، یا سایت با آپلود دستی ساخته شده)؛
2. انتشار مستقیم خروجی بیلد: `netlify deploy --dir=.next`.

**نتیجهٔ امنیتی:** در این حالت مانیفست‌ها (و شانس خواندن چانک‌های سرور) برای
همه قابل دانلود است. بعد از درست شدن مسیر‌دهی، `/BUILD_ID` باید ۴۰۴ بدهد — این
هم بخشی از تأیید است.

---

## ۲. تنظیمات درست (پنل Netlify و `netlify.toml`)

| مورد | مقدار درست | چرا |
| --- | --- | --- |
| Framework preset | **Next.js** | تا Netlify runtime را بشناسد |
| Base directory | **خالی** (ریشهٔ مخزن) | `package.json` در ریشه است؛ اگر خالی نباشد تشخیص فریم‌ورک از کار می‌افتد |
| Build command | `npm run build` → `next build` | `next export`/`next build && next export` هیچ تابعی نمی‌سازد |
| Publish directory | `.next` | مقدار مستندشده برای Next.js؛ آداپتر خودش مسیر‌دهی و تابع را می‌سازد |
| Node | `NODE_VERSION = "22"` | Next 16 روی Node قدیمی بیلد نمی‌شود |
| Functions | پیش‌فرض | نه `[functions]` لازم است نه `[[plugins]]` دستی — ولی ما عمداً آداپتر را pin کرده‌ایم (بند ۳) |

این مقادیر در `netlify.toml` مخزن هستند و همان‌ها باید در پنل هم دیده شوند؛ اگر
در پنل مقدار دیگری نوشته شده باشد، **پنل بر فایل مقدم است** و باید اصلاح شود.

متغیرهای محیطی (Scope: **Functions**، و برای `NEXT_PUBLIC_SITE_URL` هر دو
scope):

```
DATABASE_URL=postgresql://…            # الزامی؛ بدون آن سایت با ۵۰۳ database_unconfigured بالا می‌آید
NEXT_PUBLIC_SITE_URL=https://hermiplan.netlify.app
SMS_PROVIDER_KEY=…                     # اختیاری؛ بدون آن ورود موبایل ۵۰۳ می‌دهد
```

بدون `DATABASE_URL` هم سایت **بالا می‌آید** (صفحهٔ اصلی، `/builder`، خروجی از
فایل)، فقط مسیرهای پایگاه‌داده ۵۰۳ می‌دهند — این رفتار عامدانه است و در
`docs/AUDIT-REPORT.md` ثبت شده.

---

## ۳. چرا آداپتر را pin کرده‌ایم

مستندات Netlify می‌گوید آداپتر به‌طور خودکار نصب می‌شود و بهتر است pin نشود.
ولی در همین سایت، همین «خودکار» اجرا نشد و نتیجه‌اش ۴۰۴ سراسری بود. بنابراین
در `netlify.toml` این مخزن:

```toml
[[plugins]]
  package = "@netlify/plugin-nextjs"
```

و در `package.json` نسخهٔ `@netlify/plugin-nextjs` در `devDependencies` هست.
این همان روش رسمی pin کردن است و تضمین می‌کند آداپتر مستقل از تشخیص پنل اجرا
شود (چه دیپلوی متصل به گیت، چه `netlify deploy --build`). برای برگشت به
به‌روزرسانی خودکار: بلوک `[[plugins]]` و وابستگی را حذف کنید.

---

## ۴. چطور درست دیپلوی کنیم

**راه درست (توصیه‌شده):** مخزن را در پنل وصل کنید؛ هر push به شاخهٔ تولید
خودش بیلد و دیپلوی می‌شود و آداپتر با همان `netlify.toml` اجرا می‌شود.

**با Netlify CLI:**

```bash
netlify link                 # وصل شدن به سایت
netlify deploy --build       # پیش‌نمایش (draft)
netlify deploy --build --prod
```

**هرگز** این‌ها را انجام ندهید:

```bash
netlify deploy --dir=.next --prod     # ✗ خروجی خام؛ نتیجه‌اش همان ۴۰۴
netlify deploy --dir=out --prod       # ✗
```

اگر بیلد در پنل شکست خورد: **Deploys → آخرین دیپلوی → Deploy log** و بعد
**Clear cache and deploy site**. اگر بیلد موفق است ولی سایت ۴۰۴ می‌دهد، در لاگ
دنبال خطوط آداپتر بگردید (`@netlify/plugin-nextjs` / `Next.js Runtime`): نبودشان
یعنی آداپتر اجرا نشده است.

> ⚠️ اگر روی این مخزن `next build` را **محلی** اجرا می‌کنید، پیش از آن سرور
> `next start` را ببندید؛ در غیر این صورت `.next` زیر پای سرور بازنویسی می‌شود.

---

## ۵. چک‌لیست تأیید (قابل اجرا)

```bash
npm run deploy:check                                                   # تنظیمات + خروجی بیلد
npm run deploy:check -- --url https://hermiplan.netlify.app            # + سنجش زنده
npm run deploy:check -- --url https://hermiplan.netlify.app --json     # برای CI
```

خروجی‌ها: `0` سالم، `1` مانع، `2` بررسی زنده ممکن نشد (شبکه/آدرس).

چه چیزی بررسی می‌شود:

- `netlify.toml` وجود دارد و `command` واقعاً `next build` را صدا می‌زند؛
- `publish = ".next"` است و نه `out`/`public`/`dist`/`.next/static`؛
- `@netlify/plugin-nextjs` هم در `netlify.toml` و هم در `package.json` هست؛
- `NODE_VERSION` و `.nvmrc` هر دو ۲۲ هستند؛
- وابستگی‌های لازم بیلد (typescript، `@types/*`، `@tailwindcss/postcss`) در `package.json` هستند؛
- `.next/` و `.netlify/` در `.gitignore` هستند؛
- `public/_redirects` قاعدهٔ سرتاسری `/* … 404` ندارد (که مسیرها را می‌بلعد)؛
- خروجی بیلد (`BUILD_ID` + مانیفست) هست و مسیر `/` و مسیرهای API در آن‌اند؛
- در حالت زنده: `/` صفحهٔ فارسی HERMIPLAN است (نه صفحهٔ ۴۰۴ نتلیفای)،
  `/api/health` **JSON** می‌دهد (یعنی تابع وجود دارد)، `/builder`، `/robots.txt`،
  `/sitemap.xml` پاسخ می‌دهند، `/api/projects` بدون کوکی ۴۰۱/۴۰۳/۵۰۳ می‌دهد؛
- و **اثر انگشت خرابی**: اگر `/BUILD_ID` یا `/app-path-routes-manifest.json` با
  ۲۰۰ جواب بدهد، یعنی خروجی خام منتشر شده و همان ۴۰۴ سراسری در راه است.

پس از هر دیپلوی، این سه خط باید درست باشند:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hermiplan.netlify.app/         # 200
curl -s https://hermiplan.netlify.app/api/health                               # JSON
curl -s -o /dev/null -w "%{http_code}\n" https://hermiplan.netlify.app/BUILD_ID # 404
```

---

## ۶. محدودیت‌های مستندشدهٔ Next روی Netlify (مربوط به این پروژه)

از مستندات Netlify/OpenNext؛ هیچ‌کدام در این پروژه استفاده نمی‌شود، ولی برای
تغییرات آینده باید بدانید:

- SSR با `runtime = "edge"` در ریجن توابع اجرا می‌شود، نه در لبه (عملکرد کم
  نمی‌شود، فقط محل اجرا فرق دارد).
- `rewrites` در `next.config` **نمی‌تواند** به فایل استاتیک داخل `public` اشاره کند.
- هدرها و ریدایرکت‌ها **بعد از** middleware ارزیابی می‌شوند (برای CSP ما که در
  middleware با nonce ساخته می‌شود، همین ترتیب درست است).
- middleware با ران‌تای Node: افزونه‌های C++ و `fs` پشتیبانی نمی‌شوند (middleware
  ما فقط هدر می‌سازد).
- Netlify Forms بدون کار اضافه با Next کار نمی‌کند؛ این پروژه فرم Netlify ندارد.

---

## ۷. اگر باز هم ۴۰۴ دیدید

1. `npm run deploy:check -- --url https://hermiplan.netlify.app` را اجرا کنید؛
   پیام‌ها دقیقاً می‌گویند کدام حلقهٔ زنجیره شکسته است.
2. اگر خروجی `raw_next_publish` بود: دیپلوی از مسیر `--dir` را کنار بگذارید و
   از گیت یا `--build` استفاده کنید؛ سپس **Clear cache and deploy site**.
3. اگر خروجی `static_404` بود ولی `raw_next_publish` نبود: پنل → Deploys را
   ببینید؛ اگر دیپلوی وجود ندارد، سایت به شاخهٔ اشتباه وصل است (شاخه باید همان
   شاخه‌ای باشد که کد اپ روی آن است).
4. اگر `health_not_json` بود: آداپتر اجرا نشده؛ `[[plugins]]` و وابستگی
   `@netlify/plugin-nextjs` را چک کنید و دیپلوی بدون کش بگیرید.
5. اگر همه سبز بود ولی مرورگر ۴۰۴ می‌دهد: کش مرورگر/سرویس‌ورکر یا آدرس اشتباه؛
   خروجی `curl` را ملاک بگیرید، نه تب قبلی مرورگر.

مسیر راهنمای خود Netlify برای همین خطا:
<https://answers.netlify.com/t/support-guide-i-ve-deployed-my-site-but-i-still-see-page-not-found/125>

---

## ۸. شواهد این پروژه

- `docs/evidence/netlify-config.txt` — خروجی `npm run deploy:check` (تنظیمات و خروجی بیلد)
- `docs/evidence/netlify-live.txt` — سنجش زندهٔ دامنه، با ثبت همان اثر انگشت
  `raw_next_publish` که علت را نشان داد
