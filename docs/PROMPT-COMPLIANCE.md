# جدول تطبیق مأموریت — HERMIPLAN

> **وضعیت فاز:** گزارش پیشرفت ارائه‌شده؛ تأیید نهایی در انتظار بررسی شواهد.
> **شاخه:** `arena/2f8571d5-hermiplan` · **کامیت مبنا:** `42a7a78` (این سند پس از آن اضافه شده است)
> **تاریخ گزارش:** ۲۰۲۶-۱۰-۳۱ · همه اعداد این سند از خروجی واقعی تست‌های ثبت‌شده در
> [`docs/evidence/`](evidence/) گرفته شده‌اند، نه از حافظه یا تخمین.

راهنمای وضعیت:

| نشان | معنی |
| --- | --- |
| ✅ انجام‌شده | پیاده‌سازی + آزمون یا شاهد اجراشده (نه ادعا) |
| 🟡 ناقص | بخشی پیاده/آزموده شده؛ دقیقاً در ستون «آنچه باقی مانده» آمده است |
| ❌ انجام‌نشده | با دلیل، و در بخش ۴ (کارهای باز) با ریسک و پیش‌نیاز |

---

## ۰. خلاصه شمارش

| حوزه | ✅ | 🟡 | ❌ |
| --- | --- | --- | --- |
| ۳ — CPM | ۹ | ۰ | ۰ |
| ۴ — تقویم و سیاست زمان | ۳ | ۰ | ۰ |
| ۵ — منابع | ۲ | ۰ | ۰ |
| ۶ — EVM و پیشرفت | ۵ | ۱ | ۰ |
| ۷ — قیمت‌گذاری | ۴ | ۲ | ۱ |
| ۸ — امنیت | ۱۲ | ۰ | ۰ |
| ۹ — پایگاه داده | ۴ | ۰ | ۰ |
| ۱۰ — کیفیت کد | ۵ | ۰ | ۰ |
| ۱۱ — آزمون‌ها | ۵ | ۰ | ۰ |
| ۱۲ — تجربه کاربری | ۴ | ۱ | ۰ |
| ۱۳ — ترتیب فازها | ۱ | ۰ | ۱ (مهاجرت production — عمداً متوقف) |
| ۱۴ — ماژول‌های آینده | ۱ | ۰ | ۰ |
| ۱۵ — معیارهای پذیرش | ۱ | ۰ | ۰ |
| ۱۶ — خروجی‌های هفت‌گانه | ۷ | ۰ | ۰ |
| **جمع** | **66** | **4** | **3** |

---

## ۱. جدول تطبیق معیارها

### ۳. موتور CPM

| معیار مأموریت | وضعیت | شاهد در کد | شاهد آزمون / سند | آنچه باقی مانده |
| --- | --- | --- | --- | --- |
| FNLT واقعی: گذر پسرو، تعامل با تقویم، شناوری منفی، گزارش نقض، تفکیک تاریخ مجاز و محاسبه‌شده + ۷ آزمون | ✅ | `src/lib/engine/schedule.ts` (بلوک `case "FNLT"` در گذر پسرو) | `scripts/engine-regressions.ts` §۱ — **۱۵ بررسی** (بیش از ۷ خواسته‌شده): سقف `LF`، `fnlt-violated` با تاریخ محاسبه‌شده/مجاز و روزهای نقض، شناوری منفی −۲، تشخیص روز غیرکاری | — |
| MSO: تشخیص تضاد، نمایش تاریخ محدودیت/محاسبه‌شده و علت + ۵ آزمون | ✅ | `schedule.ts` (بلوک `MSO`) | §۲ — **۲۰ بررسی**: `mso-conflicts-with-logic` با `applied:false` + علت، `mso-before-project-start`، `mso-later-than-successors` | — |
| جدول کامل رفتار محدودیت‌ها | ✅ | `schedule.ts` + `types.ts` (`ActivityConstraintResult`) | `docs/ENGINE.md` §۵: برای هر ۴ نوع، اثر در گذر پیشرو/پسرو، تشخیص‌ها، وضعیت `applied` | — |
| نقاط عطف: نقطه کنترل مستقل آینده «رسیده» شمرده نشود + ۷ سناریو | ✅ | `analysis.ts` (چهار حالت `reached/late/upcoming/unscheduled`) | §۳ — ۸ بررسی؛ `docs/ENGINE.md` §۶ | — |
| Baseline: تفکیک انحراف شروع/پایان از تغییر مدت (مثال d1–d5 در برابر d3–d7 ⇒ جابه‌جایی پایان ۲، تغییر مدت ۰) | ✅ | `analysis.ts` (`workingDayDiff`, `BaselineVarianceRow`) | §۴ — ۱۴ بررسی با همان مثال عددی؛ `ENGINE.md` §۹ | — |
| وابستگی نامعتبر: پیش‌نیاز گمشده نادیده گرفته نشود | ✅ | `schedule.ts` (`unknown-predecessor`, error) | §۸ — ۱۴ بررسی؛ پروژه `invalid` می‌شود | — |
| وابستگی به خود، وابستگی تکراری | ✅ | `schedule.ts` (`self-dependency`, `duplicate-dependency`) | §۸ | — |
| چرخه با نمایش مسیر، بدون NaN/Infinity/تاریخ ساختگی | ✅ | `schedule.ts` (`circular-dependency` + `unschedulable`) | §۸ + `edge-case-audit` (بررسی `NaN`/`Infinity` در همه خروجی‌ها) | — |
| تفکیک «خطای داده» از «چرخه» از «تضاد محدودیت» | ✅ | `Diagnostic.kind`: `data` / `cycle` / `dependency` / `constraint` / `calendar` / `capacity`؛ `AnalysisStatus` مشتق از همین‌ها | §۸ + `docs/ENGINE.md` §۱۲ | — |

### ۴. تقویم و سیاست زمان

| معیار | وضعیت | شاهد در کد | شاهد آزمون / سند | باقی‌مانده |
| --- | --- | --- | --- | --- |
| بدون fallback خاموش به ایندکس ۰ برای تاریخ وضعیت؛ چهار حالت (پیش از شروع / داخل بازه / روز غیرکاری / پس از پایان) با یک تابع مشترک | ✅ | `src/lib/engine/calendar.ts` → `resolveDatePosition()` | §۱۱ — **۱۵ بررسی** برای هر چهار حالت؛ `ENGINE.md` §۲ | — |
| یک سیاست مستند گرد کردن مدت اعشاری + ۸ آزمون | ✅ | `src/lib/engine/normalize-input.ts` + `src/lib/validation.ts` (Zod) | `ENGINE.md` §۳ + §۱۲ — **۱۲ بررسی** (۲٫۴، ۲٫۵، ۰٫۴، منفی، Lag ۱٫۶، Lag −۱٫۶، idempotency، بودجه، نبود هشدار برای ورودی صحیح) | — |
| روابط عددی FS/SS/FF/SF با Lag مثبت/صفر/منفی و تعطیلات | ✅ | `schedule.ts` (`earlyStartFor` / `latestFinishFor`) | §۹ — ۱۲ بررسی با تقویم دارای تعطیلی (FS+1، SS+2، FF±0، SF+1، SF کلمپ‌شده) | Lag منفی در رابطه‌های SS/FF/SF به‌صورت جداگانه آزموده نشده (پوشش FS− و ریاضیات مشترک) |

### ۵. منابع

| معیار | وضعیت | شاهد | آزمون | باقی‌مانده |
| --- | --- | --- | --- | --- |
| تخصیص/مصرف محاسبه شود، نه تسطیح | ✅ | `schedule.ts` → `computeAllocations` (بدون هیچ الگوریتم تسطیح) | `engine-verification` (بیش‌تخصیص شناسایی می‌شود؛ فعالیت پشت‌سرهم بیش‌تخصیص نمی‌سازد) | — |
| نبود تسطیح خودکار، در UI/گزارش ادعا نشود | ✅ | `ReportView.tsx`، `html.ts` («بدون تسطیح خودکار»)، `page.tsx` | `api-integration` (بسته / HTML تولید می‌شود)، `edge-case-audit` | — |

### ۶. EVM و پیشرفت

| معیار | وضعیت | شاهد | آزمون | باقی‌مانده |
| --- | --- | --- | --- | --- |
| تفکیک پیشرفت زمان‌محور / فیزیکی / مالی | ✅ | `analysis.ts` → `progress.timeBased`, `progress.physical`, `progress.financial` | §۵ — پیشرفت زمان‌محور ۳۰٪، فیزیکی ۱۲۰٪، مالی ۳۰٪ به‌صورت هم‌زمان | — |
| مدل مقداری (برنامه/اجرا، بیش از ۱۰۰٪، مقدار کل صفر، بدون کلمپ خاموش) | ✅ | `quantityProgress()` | §۵ — `over`, `physicalProgress=120`, `planned=0 ⇒ null + invalid` | — |
| حسابرسی PV/EV/AC/SV/CV/SPI/CPI/BAC/EAC/ETC/VAC | ✅ | `analysis.ts` (بلوک EVM) | §۶ — **۲۳ بررسی** برای هر فرمول و مرز تقسیم بر صفر | — |
| تقسیم بر صفر ⇒ `null` نه ۰/Infinity/NaN | ✅ | `safeDiv`, `spi/cpi: number \| null` | §۶ + `edge-case-audit` | — |
| مدل EAC مستند | ✅ | `eacMethod: "bac-cpi"` | `ENGINE.md` §۸ + §۶ | — |
| یک ارز در کل پروژه | ✅ | `meta.currency` واحد برای پروژه؛ اعتبارسنجی سه ارز؛ سیاست پول در `src/lib/engine/money.ts` | `validation.ts`؛ رگرسیون §۱۵ — **۱۱ بررسی** (گرد کردن یک‌بار، `total === Σ اجزای چاپ‌شده`، نیم‌ریال رو به بالا، `NaN`/`Infinity` ⇒ ۰)؛ `ENGINE.md` §۱۳ | تبدیل ارز در دامنه محصول نیست (یک پروژه = یک ارز) |

### ۷. قیمت‌گذاری

| معیار | وضعیت | شاهد | آزمون | باقی‌مانده |
| --- | --- | --- | --- | --- |
| تفکیک نوع داده: رسمی/فهرست‌بها/بازار/برآوردی/نمونه/شاخص/دستمزد | 🟡 | `market/rates.ts` → `kind: official-wage \| market-quote \| reference-estimate` + `verification: verified \| unverified \| reference-estimate` | §۷ — ۱۰ بررسی فراداده | انواع «نمونه (sample)» و «شاخص (index)» به‌عنوان مقدار مستقل مدل نشده‌اند؛ ردیف واقعی فهرست‌بها وارد نشده (عمدی) |
| هر داده ۱۲ ویژگی: عنوان، مقدار، واحد، ارز، منطقه، اعتبار، ارجاع سند، پیوند، وضعیت اعتبارسنجی، نوع، آخرین به‌روزرسانی، یادداشت | ✅ | `RateItem` (عنوان/مقدار/واحد) + `RateProvenance` (نوع، اعتبار، منبع، `sourceRef`, `sourceUrl`, `asOfIso`, `lastUpdatedIso`, `validUntilIso`, `region`, `currency`, `note`) | §۷ — بررسی وجود و نوع هر فیلد؛ نمایش ستون «تاریخ مرجع» و «سند/پیوند» در گزارش | مقادیر `sourceRef`/`sourceUrl` عمداً `null` هستند (سندی در مخزن نیست) و در گزارش «سند ثبت نشده» نمایش داده می‌شود |
| حذف ادعای «رسمی» در نبود سند | ✅ | `rates.ts` + `page.tsx` + `steps.tsx` + `ReportView.tsx` + `html.ts` | بازبینی متن؛ `verified=false` برای کل کاتالوگ | — |
| مسیر واحد نمایش→اعتبارسنجی→تازگی→قرنطینه→نرمال‌سازی→اعمال (رفع ناهم‌خوانی نمایش/اعمال) | 🟡 | `market/engine.ts` (`resolveRateFromSnapshot`, `applyMarketRates`, قرنطینه فید، `feedError`) + `useProject.ts` | تست دود/`edge-case-audit`؛ نمایش و اعمال از یک snapshot | «persist» در همان مسیر واحد: نرخ‌ها در ورودی پروژه ذخیره می‌شوند ولی یک رخداد حسابرسی مستقل برای «اعمال نرخ» ثبت نمی‌شود |
| تفکیک سناریوی افزایش هزینه از تعدیل قراردادی (۳٪ ماهانه مرکب = سناریو) | ✅ | `computeEscalation` → `scenario: true` + `note` | §۷ — ماهِ وضعیت ضریب ۱، ماه‌های بعد > ۱، متن «سناریو»؛ `ENGINE.md` §۱۱ | — |
| نگاشت تاریخ→دوره شاخص بدون fallback «ماه اول» | ✅ | `computeEscalation` (ماه‌ها **پس از** ماه وضعیت) | §۷ — وضعیت پیش از پروژه ⇒ ۱٫۳۳۱ (سه ماه فاصله) نه ۱٫۱ | — |
| ارزیابی ردیف‌های واقعی فهرست‌بها یا محدودکردن ادعاها + آماده‌سازی ساختار | ❌ | — | `rates.ts` → `RATE_DATA_POLICY.requiredForVerified` (ساختار آماده، سند موجود نیست) | ورود داده رسمی فهرست‌بها نیازمند سند و تأیید شماست؛ تولید عدد ممنوع |

### ۸. امنیت

| معیار | وضعیت | شاهد | آزمون | باقی‌مانده |
| --- | --- | --- | --- | --- |
| `isPublic` پیش‌فرض false + انتشار صریح و قابل بازگشت + رکورد حسابرسی | ✅ | `schema.ts`, `0002_security_hardening.sql`, `api/projects/[id]` | `api-integration` §۳ — ۹ سناریو (خصوصی، انتشار، لغو، رخداد) | — |
| مسیر گزارش، دانستن UUID را مجوز نداند | ✅ | `app/report/[id]/page.tsx` (فقط مالک؛ بدون استثنای `isPublic`) | `api-integration` §۳: مالکِ UUID پس از ساخت لینک هم ⇒ ۴۰۴ برای غریبه | — |
| توکن اشتراک: تصادفی، هش‌شده، منقضی‌شدنی، قابل ابطال + رکورد حسابرسی | ✅ | `drizzle/0003_share_tokens.sql`, `lib/server/share-token{,-core}.ts`, `app/s/[token]`, `api/projects/[id]/share` | `security-checks` §۷ — **۱۲ بررسی** (آنتروپی ۲۵۶ بیت، یگانگی ۱۰۰۰ توکن، هش SHA-256، رد UUID/مسیر)؛ `api-integration` §۳ — **۱۸ سناریو** (ساخت/دسترسی/ابطال/ابطال همه/انقضا/CSRF/افشا نشدن توکن)؛ `db-integrity` §۲ (یکتایی و آبشاری‌شدن) | — |
| خاموش‌کردن اشتراک ⇒ ابطال فوری همه لینک‌ها | ✅ | `api/projects/[id]/route.ts` (`revokeAllShareTokens` در همان درخواست) | `api-integration` §۳ (پس از ابطال همه: `/s/…` ⇒ ۴۰۴ و `is_public=false`) | — |
| مجوزسرور روی هر endpoint پروژه | ✅ | `api/projects/route.ts` (فیلتر مالکیت)، `api/projects/[id]` (۴۰۴ برای غیرمالک) | §۲ — ۶ سناریوی منفی (خواندن/ویرایش/حذف/انتشار) | — |
| OTP واقعی: ارسال SMS، CSPRNG، هش، انقضا، محدودیت تلاش، فاصله ارسال، مصرف اتمیک | 🟡 | `lib/server/{otp,sms}.ts`, `api/auth/route.ts` | `security-checks` §۲–۳؛ `api-integration` §۶ (۱۰ سناریو) | ارسال واقعی به اپراتور آزموده نشده (کلید سرویس موجود نیست)؛ مسیر ۵۰۳ و مسیر دمو آزموده شده |
| اصلاح `normalizePhone` | ✅ | `lib/server/phone.ts` | `security-checks` §۱ — ۲۱ بررسی (ارقام فارسی/عربی، +98/0098/98/09، رد قالب‌های نامعتبر) | — |
| محدودیت نرخ با فروشگاه مشترک + مستندسازی هر endpoint | ✅ | `lib/server/rate-limit.ts` (upsert اتمیک PostgreSQL) | `security-checks` §۶ (حالت تخریب‌شده)؛ `api-integration` §۹؛ جدول سهمیه‌ها در `README.md` | — |
| بازبینی نشست/کوکی (HttpOnly/Secure/SameSite/انقضا/ابطال/CSRF) | ✅ | `lib/server/auth.ts`, `lib/server/http.ts` | `security-checks` §۴ (CSRF)؛ `api-integration` §۶ (خروج ⇒ ابطال نشست) | — |
| سخت‌سازی + آزمون‌های منفی مجوز | ✅ | `next.config.ts` (هدرها)، `src/middleware.ts` | `api-integration` §۲؛ `production-smoke.txt` (هدرها روی build تولیدی) | — |
| CSP سخت‌گیرانه با nonce (بدون `unsafe-inline`/`unsafe-eval` در script) | ✅ | `src/middleware.ts` (nonce هر درخواست، `strict-dynamic`، `object-src 'none'`، `base-uri`، `form-action`، `frame-ancestors 'none'`) | `npm run test:csp` — **۲۲ بررسی** روی سرور تولیدی: هدر موجود، بدون `unsafe-inline`، nonce همه اسکریپت‌های inline، مجاز بودن تنها منبع بیرونی (CDN فونت) | `style-src` ناچار `'unsafe-inline'` دارد (ویژگی‌های `style` در React nonce نمی‌پذیرند) — محدودیت مستند؛ رندر واقعی مرورگر آزموده نشده |

### ۹. پایگاه داده

| معیار | وضعیت | شاهد | آزمون | باقی‌مانده |
| --- | --- | --- | --- | --- |
| کلید خارجی، ایندکس، یکتایی، تراکنش، رخداد حسابرسی | ✅ | `drizzle/0001..0003` + `scripts/migrate.ts` | `docs/evidence/legacy-db.txt` — **۲۵ بررسی** روی پایگاه **نسخه قبل** (PostgreSQL 18.6 واقعی): FK، ۹ ایندکس، تبدیل `attempts`، جدول توکن، حفظ همه ردیف‌ها؛ `db-integrity` — **۱۱ بررسی** هم‌زمانی/قید | FK مالکیت به‌صورت `NOT VALID` اضافه شده (داده قدیمی معیوب مهاجرت را نمی‌شکند) |
| یتیم‌ها و تاریخچه | ✅ | `project_events` (انتشار/اشتراک)، `ON DELETE CASCADE`/`SET NULL` | `npm run test:db:integrity` §۳ روی **PostgreSQL واقعی**: کوئری یتیم‌ها (۰ ردیف) + `VALIDATE CONSTRAINT` موفق و سپس ROLLBACK | داده تولیدی شما در دسترس نیست؛ همان کوئری باید پیش از مهاجرت روی نسخه staging اجرا شود |
| آماده‌سازی ساختار Company/CompanyMember/ProjectMember/Role/… (ساخت بدون نیاز ممنوع) | ✅ | `docs/AUDIT-REPORT.md` §۳ + بخش ۷ (طرح پیشنهادی) | — | جداول ساخته نشده‌اند (طبق درخواست شما: آماده‌سازی، نه ایجاد) |
| قواعد چندمستأجری | ✅ | `schema.ts` (مالکیت کاربر/مهمان)، `README.md` §مدل دسترسی | `api-integration` §۲ | نقش‌های ریزدانه تا زمان نیاز محصول ساخته نمی‌شوند |

### ۱۰. کیفیت کد

| معیار | وضعیت | شاهد | آزمون |
| --- | --- | --- | --- |
| منطق بیرون از UI | ✅ | `lib/engine`, `lib/market`, `lib/report` بدون React؛ کامپوننت‌ها فقط نمایش | ساخت و آزمون‌ها |
| لایه‌بندی API/DB | ✅ | `app/api` نازک، `lib/server` سرویس، `db` دسترسی داده | — |
| کاهش `any` | ✅ | `grep -rE ":\s*any|as any"` در `src/` ⇒ **۰** (تنها تطبیق، یک توضیح متنی است) | بازبینی کد |
| خطاهای محاسباتی تایپ‌شده | ✅ | `Diagnostic { kind, severity, code, message, activityIds, remedy }` + `AnalysisStatus` | §۱۳ — هر تشخیص راه‌حل دارد |
| محافظت از تقسیم بر صفر/NaN/محدودیت‌ها | ✅ | `safeDiv`, کلمپ‌ها، سقف بدنه ۳MB | `edge-case-audit`, §۶ |
| عملکرد | ✅ | سقف ۳MB، مسیرهای خطی، `npm run test:load` | `docs/evidence/load.txt` — ۱۹۴٫۸ درخواست/ثانیه تحلیل (p95 = ۹۲ms) و ۱۱۱ درخواست/ثانیه SSR (p95 = ۱۴۳ms)، ۰ خطا؛ **یک پروسه روی ماشین سندباکس**، نه ظرفیت Netlify |

### ۱۱. آزمون‌ها

| معیار | وضعیت | شاهد |
| --- | --- | --- |
| پوشش واحد: دو گذر، شناوری، چهار رابطه، Lag، تقویم، نقاط عطف، محدودیت‌ها، چرخه، Baseline، پیشرفت، EVM، منابع، نرخ‌ها، افزایش هزینه، نگاشت تاریخ، سیاست پول | ✅ | `npm test` — ۷ مجموعه؛ `engine-verification` ۸۱ + `engine-regressions` **۱۹۱** (۱۵ بخش) + `security-checks` **۲۶۱** |
| ۲۲ سناریوی یکپارچگی | ✅ | `api-integration` — **۶۷ سناریو** در ۹ بخش، روی **PostgreSQL 18.6 واقعی** (`api-integration.txt` / `-otp.txt`) |
| آزمون مرجع محاسبه‌شده دستی | ✅ | همه انتظارهای `engine-regressions.ts` از تعریف‌های `docs/ENGINE.md` مشتق شده‌اند (نه از خروجی کد) |
| اجرای واقعی فرمان‌های `package.json` | ✅ | `docs/evidence/npm-ci.txt` (`npm ci` واقعی)، `typecheck.txt`، `lint.txt`، `tests.txt`، `api-integration.txt`، `build.txt` |

### ۱۲. تجربه کاربری

| معیار | وضعیت | شاهد | باقی‌مانده |
| --- | --- | --- | --- |
| هشدارها: چه شد / کدام فعالیت / علت / پیامد / راه‌حل | ✅ | `Diagnostic` + `DIAGNOSTIC_REMEDIES` (۲۵ کد)؛ نمایش در `ReportView`، `steps.tsx` (`AnalysisAlerts`)، `html.ts` (ستون راه‌حل)، برگه `Diagnostics` در XLSX | — |
| تاریخ محدودیت در برابر تاریخ محاسبه‌شده در برابر نقض | ✅ | `constraintCell()` در گزارش، `html.ts`، ستون محدودیت در Excel | — |
| هر نرخ با نوع/منبع/تاریخ/واحد | ✅ | جدول «نرخ‌های اعمال‌شده روی منابع پروژه» در سه خروجی هم‌زمان: `ReportView` (۸ ستون: نوع داده، واحد، ارز، نرخ اعمال‌شده، تاریخ مرجع، سند/پیوند، اعتبار)، `html.ts` (همان ۸ ستون، آزمون §۱۴ رگرسیون) و برگه `Diagnostics`/`Pricing` در XLSX | سند رسمی برای هیچ ردیف وجود ندارد ⇒ همه «تأییدنشده» و «سند ثبت نشده» |
| پیشرفت زمان‌محور و فیزیکی هرگز یک برچسب نگیرند | ✅ | سه کاشی مستقل + جدول EVM | — |
| بازبینی موبایل و دسکتاپ | 🟡 | `npm run test:layout` — رندر پیکسلی نمودار در ۱۱۸۰ و ۳۶۰ پیکسل (بدون بریدگی، بدون بوم خالی)، قواعد چاپ A4، `viewport`، نبود `min-width` بزرگ‌تر از ۳۶۰، ظرف اسکرول افقی | آزمون مرورگری (اسکرین‌شات واقعی CSS) اجرا نشده: کتابخانه‌های `libnspr4`/`libnss3` نصب نیست و نصبشان root می‌خواهد — در بخش ۴ |
| بدون بازطراحی بی‌دلیل | ✅ | تغییرات محدود به متن/ستون‌های لازم | — |

### ۱۳–۱۶. ترتیب، آینده، پذیرش، خروجی‌ها

| معیار | وضعیت | شاهد |
| --- | --- | --- |
| ترتیب فاز ۰ تا ۶ | ✅ | تاریخ کامیت‌ها: ممیزی → امنیت (`20db26e`) → زمان‌بندی/قیمت‌گذاری/پاک‌سازی/آزمون (`42a7a78` و این بسته) |
| هیچ تغییری در production پیش از تأیید | ✅ | هیچ مهاجرت یا استقرار روی پایگاه شما اجرا نشد (بخش ۳) |
| ماژول‌های آینده فقط جهت‌دار | ✅ | `docs/AUDIT-REPORT.md` §۷ (پیشنهاد فاز بعد) — بدون پیاده‌سازی |
| معیارهای پذیرش تضعیف نشوند و موارد ناتمام صریح باشند | ✅ | همین سند + `docs/AUDIT-REPORT.md` §«معیارهای پذیرش ناتمام» |
| هفت خروجی مأموریت | ✅ | `docs/AUDIT-REPORT.md` §۱ (جدول ایراد)، §۲ (معماری)، §۳ (DB)، §۴ (آزمون)، §۵ (امنیت)، §۶ (استقرار)، §۷ (فاز بعد) |

---

## ۲. مستندات و شواهد

### ۲-۱. نقشه سندها

| سند | چه چیزی در آن است | بخش‌های مرتبط با این بررسی |
| --- | --- | --- |
| [`docs/ENGINE.md`](ENGINE.md) | قرارداد محاسباتی: مبنای زمانی §۱، تاریخ وضعیت §۲، سیاست گرد کردن §۳، دو گذر و چهار رابطه §۴، جدول محدودیت‌ها §۵، نقاط عطف §۶، سه سنجه پیشرفت §۷، EVM و مدل EAC §۸، Baseline §۹، منابع §۱۰، نرخ و افزایش هزینه §۱۱، تشخیص‌ها و وضعیت §۱۲، مرزها §۱۳ | §۴–§۱۱ مرجع مستقیم آزمون‌های رگرسیون‌اند |
| [`docs/AUDIT-REPORT.md`](AUDIT-REPORT.md) | ۷ خروجی مأموریت: جدول ایراد→اقدام→تست، تغییرات معماری، گزارش DB، گزارش آزمون، گزارش امنیت، گزارش استقرار، پیشنهاد فاز بعد | §۱ جدول اصلاحات، §۳ مهاجرت، §۴ آزمون، §۵ امنیت، §۶ استقرار |
| `README.md` | اجرا، فرمان‌های آزمون، متغیرهای محیطی، جدول محدودیت نرخ، مدل دسترسی، محدودیت‌های شناخته‌شده | بخش «آزمون‌ها»، «Rate limits»، «مدل دسترسی و امنیت»، «صداقت داده» |
| `DEPLOYMENT.md` | محیط، مهاجرت دستی + rollback، OTP در production، چک‌لیست پس از استقرار، خطاهای رایج | §۴ (مهاجرت)، §۵ (OTP و اشتراک)، §۸ (چک‌لیست) |
| [`docs/evidence/`](evidence/) | خروجی خام فرمان‌ها با زمان اجرا | همه فایل‌ها در بخش ۲-۳ |

### ۲-۲. فایل‌های تغییر‌یافته (نسبت به نسخه اولیه آپلودشده)

موتور و دامنه:

| فایل | تغییر |
| --- | --- |
| `src/lib/engine/schedule.ts` | بازنویسی: دو گذر کامل، FNLT/MSO/SNET، وابستگی نامعتبر و چرخه، تخصیص منابع بدون تسطیح |
| `src/lib/engine/analysis.ts` | تجمیع: سه سنجه پیشرفت، EVM با `null`، Baseline چندبعدی، نقاط عطف، تشخیص‌ها + راه‌حل، تحلیل جایگزین در خطای داخلی |
| `src/lib/engine/calendar.ts` | `resolveDatePosition` (چهار ناحیه) + `ensureViableCalendar` |
| `src/lib/engine/normalize-input.ts` *(جدید)* | سیاست واحد گرد کردن مدت/Lag + تشخیص‌ها |
| `src/lib/engine/diagnostics.ts` *(جدید)* | نقشه کد → راه‌حل (۲۵ کد) |
| `src/lib/engine/types.ts` | مدل تشخیص/وضعیت/پیشرفت/نرخ/Baseline |
| `src/lib/validation.ts` | Zod: گرد کردن، تاریخ‌های خالی، مدل مقدار |

قیمت‌گذاری:

| فایل | تغییر |
| --- | --- |
| `src/lib/market/rates.ts` | فراداده کامل نرخ + سیاست «داده مرجع» |
| `src/lib/market/engine.ts` | snapshot نمایش/اعمال، قرنطینه فید، سناریوی افزایش هزینه |

گزارش‌ها و رابط کاربری:

| فایل | تغییر |
| --- | --- |
| `src/lib/engine/money.ts` *(جدید)* | سیاست واحد پول: `roundMoney`, `sumMoney`, `percentOfMoney` (گرد کردن یک‌بار، جمع = مجموع اجزای گردشده) |
| `src/lib/server/share-token.ts` + `share-token-core.ts` *(جدید)* | توکن اشتراک ۲۵۶ بیتی، هش SHA-256، انقضا/ابطال، رکورد حسابرسی |
| `src/lib/server/report-loader.ts` *(جدید)* | بارگذاری مشترک گزارش برای `/report/[id]` و `/s/[token]` |
| `src/app/s/[token]/page.tsx` *(جدید)* | صفحه گزارش اشتراکی (فقط‌خواندنی، no-referrer، no-store) |
| `src/app/api/projects/[id]/share/route.ts` *(جدید)* | ساخت/فهرست/ابطال لینک اشتراک (مالک، CSRF، محدودیت نرخ) |
| `src/middleware.ts` *(جدید)* | CSP با nonce در هر درخواست |
| `drizzle/0003_share_tokens.sql` + rollback *(جدید)* | جدول لینک‌های هش‌شده (افزودنی) |
| `src/lib/report/export.ts` | Summary/Milestones/Baseline/Diagnostics، ستون محدودیت |
| `src/lib/report/html.ts` | بخش وضعیت تحلیل، EVM، Baseline، نقاط عطف، ستون محدودیت و راه‌حل، برچسب‌های صادق نرخ |
| `src/components/report/ReportView.tsx` | بنر وضعیت، جدول EVM، سه سنجه پیشرفت، Baseline، ستون محدودیت/سند، راه‌حل تشخیص‌ها |
| `src/components/builder/steps.tsx` | `AnalysisAlerts` (وضعیت + تشخیص + فعالیت متأثر + راه‌حل)، برچسب‌های نرخ، پنل بازار |
| `src/components/builder/ActivityTable.tsx` | مدت صحیح، گزینه FNLT |
| `src/components/builder/ScenarioPanel.tsx` | برچسب «سناریوی افزایش هزینه» |
| `src/app/page.tsx` | حذف ادعای «مصوب/رسمی» و «هموارسازی» |

امنیت و داده:

| فایل | تغییر |
| --- | --- |
| `src/lib/server/{phone,sms,otp,rate-limit,auth,http}.ts` | OTP واقعی، محدودیت نرخ مشترک، CSRF، پاک‌سازی شماره |
| `src/db/schema.ts` | `is_public=false`، `share_expires_at`، `rate_limits`، ایندکس‌ها |
| `drizzle/0001_baseline.sql`, `0002_security_hardening.sql` + rollback | مهاجرت نسخه‌دار و برگشت‌پذیر |
| `src/app/api/**` | مجوز مالکیت، ۴۰۴ بدون افشا، محدودیت نرخ، اعتبارسنجی |

آزمون‌ها و مستندات:

| فایل | تغییر |
| --- | --- |
| `scripts/engine-regressions.ts` *(جدید)* | ۱۹۱ بررسی مرجع (۱۵ بخش، شامل سیاست پول) |
| `scripts/security-checks.ts` *(جدید)* | ۲۶۱ بررسی (شامل توکن اشتراک) |
| `scripts/csp-check.ts` *(جدید)* | بازرسی CSP/nonce روی سرور در حال اجرا |
| `scripts/layout-audit.ts` *(جدید)* | رندر پیکسلی نمودار + قواعد چاپ + پیش‌شرط‌های موبایل |
| `scripts/db-integrity-check.ts` *(جدید)* | هم‌زمانی محدودیت نرخ، قیدها، `VALIDATE CONSTRAINT` روی PostgreSQL واقعی |
| `scripts/load-test.ts` *(جدید)* | آزمون بار محلی (p50/p95/p99) |
| `scripts/pg-dev-server.ts` *(جدید)* | اجرای PostgreSQL واقعی برای آزمون (devDependency `embedded-postgres`) |
| `scripts/run-tests.ts` *(جدید)* | اجرای یکپارچه `npm test` |
| `scripts/legacy-db-check.ts` *(جدید)* | بازسازی پایگاه نسخه قبل و اثبات مهاجرت بدون از دست رفتن داده |
| `scripts/api-integration.ts` | بازنویسی روی `pg` + خواننده ZIP داخلی (بدون `psql`/`python3`) |
| `scripts/migrate.ts` *(جدید)* | مهاجرت شماره‌دار با checksum |
| `docs/ENGINE.md`, `docs/AUDIT-REPORT.md`, `docs/PROMPT-COMPLIANCE.md`, `docs/evidence/**` | مستندات و شواهد |
| `README.md`, `DEPLOYMENT.md`, `.env.example`, `next.config.ts`, `package.json` (اسکریپت‌های `test:csp`, `test:layout`, `test:db:integrity`, `test:load`, `test:legacy-db`, `db:dev-server`), `docs/evidence/*` | مستندسازی، پیکربندی و شواهد |

### ۲-۳. خروجی واقعی آزمون‌ها (`docs/evidence/`)

| فایل | فرمان | نتیجه ثبت‌شده |
| --- | --- | --- |
| `npm-ci.txt` | `npm ci --no-audit --no-fund` | `added 399 packages in 13s` · EXIT=0 |
| `typecheck.txt` | `npx tsc --noEmit` | EXIT=0 (بدون خروجی) |
| `lint.txt` | `npx eslint . -f json` | ۸۴ فایل · ۰ خطا · ۰ هشدار |
| `tests.txt` | `npm test` | ۷/۷ مجموعه: ۸۱ مستقل، **۱۹۱** رگرسیون (۱۵ بخش)، smoke، edge، **۲۶۱** امنیتی، import parser، ۱۰ قالب · EXIT=0 |
| `evidence/README.md` | — | فهرست همه شواهد + فرمان بازتولید |
| `build.txt` | `npm run build` | `✓ Compiled successfully in 9.8s` · ۱۲ مسیر · EXIT=0 |
| `legacy-db.txt` | `legacy-db-check` + `db:migrate` (پایگاه دورانداختنی، PostgreSQL 18.6) | `prepare` → مهاجرت ۰۰۰۱+۰۰۰۲+۰۰۰۳ (**۲۵ بررسی**) → rollback ۰۰۰۳+۰۰۰۲ (**۶ بررسی**) |
| `production-smoke.txt` | `next start` + curl | health `ok:true`, **schemaVersion 3**, `/` و `/builder` ۲۰۰، `/report/<uuid>` و `/s/<token>` نامعتبر ۴۰۴، هدر CSP و بقیه هدرها |
| `real-postgres.txt` | سرور + `db:status` + `version()` | `PostgreSQL 18.6`، سه مهاجرت اعمال‌شده، فهرست جداول |
| `api-integration.txt` | `npm run test:api` روی build تولیدی و PostgreSQL واقعی | **۶۲ موفق / ۰ ناموفق / ۶ نادیده** (مسیر OTP در production غیرفعال است) |
| `api-integration-otp.txt` | همان، با `HERMIPLAN_ALLOW_DEMO_OTP=1` روی `next dev` | **۶۷ موفق / ۰ ناموفق / ۰ نادیده** |
| `csp.txt` | `npm run test:csp` | **۲۲ بررسی**: هدر CSP، بدون `unsafe-inline` در script، nonce همه اسکریپت‌های inline |
| `layout.txt` | `npm run test:layout` | **۲۴ بررسی**: رندر پیکسلی نمودار در ۳۶۰/۱۱۸۰ (بدون بریدگی)، A4، پیش‌شرط‌های موبایل |
| `db-integrity.txt` | `npm run test:db:integrity` | **۱۱ بررسی**: هم‌زمانی ۴۰ اتصال، یکتایی هش، CASCADE، `VALIDATE CONSTRAINT` |
| `load.txt` | `npm run test:load` | ۱۹۴٫۸ req/s تحلیل (p95 ۹۲ms) و ۱۱۱ req/s SSR (p95 ۱۴۳ms)، ۰ خطا |

---

## ۳. امنیت و داده‌ها

### ۳-۱. ماتریس کنترل دسترسی APIها

| مسیر | متد | احراز هویت / مجوز | محدودیت نرخ | CSRF | آزمون |
| --- | --- | --- | --- | --- | --- |
| `/api/projects` | GET | فقط پروژه‌های خودِ کاربر/مهمان (`owner_user` یا `guest_token`) | ۱۲۰/دقیقه | — (بدون تغییر داده) | `api` §۱، §۲ |
| `/api/projects` | POST | مهمان مجاز (کوکی مهمان HttpOnly) | ۳۰/دقیقه | ✔ | `api` §۱ |
| `/api/projects/[id]` | GET | مالک؛ غیرمالک **۴۰۴** (نه ۴۰۳) | ۱۲۰/دقیقه | — | `api` §۲، §۳ |
| `/api/projects/[id]` | PATCH | مالک؛ شامل تغییر `isPublic` و `shareExpiresAt` | ۳۰/دقیقه | ✔ | `api` §۲، §۳ |
| `/api/projects/[id]` | DELETE | مالک | ۳۰/دقیقه | ✔ | `api` §۲ |
| `/report/[id]` | GET | **فقط مالک**؛ UUID هرگز مجوز نیست ⇒ ۴۰۴ | — | — | `api` §۳ (`production-smoke` هم ۴۰۴ داد) |
| `/s/[token]` | GET | دارنده توکن معتبر (۲۵۶ بیتی، هش‌شده، منقضی‌نشده، باطل‌نشده)؛ وگرنه ۴۰۴ | ۲۴۰/دقیقه بر IP | — | `api` §۳ |
| `/api/projects/[id]/share` | GET | مالک | ۱۲۰/دقیقه | ✔ (برای POST/DELETE) | `api` §۳ |
| `/api/projects/[id]/share` | POST (ساخت لینک) | مالک | ۱۰/ساعت | ✔ | `api` §۳ (۲۰ سناریو) |
| `/api/projects/[id]/share` | DELETE (ابطال یک/همه) | مالک | ۳۰/دقیقه | ✔ | `api` §۳ |
| `/api/auth` | POST/DELETE | شماره موبایل + OTP؛ بدون سرویس پیامک ⇒ ۵۰۳ | ۱۲/دقیقه + ۵ ارسال/۱۵دقیقه + ۱۰ تأیید/۱۵دقیقه | ✔ | `api` §۶، `security` |
| `/api/analyze` | POST | عمومی (محاسبه بدون ذخیره داده؛ ورودی از بدنه) | ۶۰/دقیقه | ✔ | `api` §۵، §۹ |
| `/api/export` | POST | عمومی (تولید فایل از داده ارسالی) | ۳۰/دقیقه | ✔ | `api` §۸ |
| `/api/market` | GET | عمومی، فقط خواندن کاتالوگ/فید | — | — | `smoke` |
| `/api/health` | GET | عمومی، بدون داده حساس | — | — | `production-smoke` |

نکته‌های امنیتی ثبت‌شده:
- UUID هرگز مجوز نیست: تفکیک ۴۰۳/۴۰۴ حذف شد تا وجود پروژه افشا نشود (`api` §۲).
- انتشار گزارش، دسترسی به **داده خام** را باز نمی‌کند (`api` §۳).
- در نبود سرویس پیامک، هیچ ردیف OTP نوشته نمی‌شود و کدی در پاسخ نمی‌آید (`api` §۶).

### ۳-۲. حفظ داده‌های قبلی (شاهد اجراشده)

`scripts/legacy-db-check.ts` پایگاه نسخه قبل را بازسازی می‌کند (`is_public=true` پیش‌فرض، `otp_codes.attempts` از نوع text، بدون `rate_limits`)، داده تزریق می‌کند، سپس مهاجرت اجرا می‌شود:

| بررسی | نتیجه |
| --- | --- |
| پروژه‌ها / کاربران / کدهای OTP / نشست‌ها | همه حفظ شدند (۲/۱/۱/۱) |
| JSON پروژه | بدون تغییر |
| `attempts` از text به integer | تبدیل شد و مقدار ۳ حفظ شد |
| انتشار **آگاهانه** (ثبت‌شده در `project_events`) | `is_public=true` باقی ماند |
| انتشار **تصادفی** نسخه قبل | به `false` تبدیل شد (اقدام امن‌سازی، قابل بازگردانی دستی) |
| ستون/جدول حذف‌شده | هیچ (`0001`/`0002`/`0003` فقط افزودنی‌اند) |
| مهاجرت `0003_share_tokens` | جدول `project_share_tokens` ساخته شد، هیچ پروژه‌ای حذف/تغییر نشد، `CASCADE` و ایندکس یکتای هش تأیید شد (**۲۵ بررسی**) |
| rollback | اجرا شد: `attempts` ⇒ text، `rate_limits` حذف، پیش‌فرض `is_public` ⇒ true، **پروژه‌ها حذف نشدند و دوباره عمومی نشدند** |
| اعمال مجدد پس از rollback | موفق (حذف ردیف دفتر + `db:migrate`) |

### ۳-۳. مهاجرت پایگاه داده

| مورد | وضعیت |
| --- | --- |
| فایل‌ها | `drizzle/0001_baseline.sql`، `0002_security_hardening.sql`، `0003_share_tokens.sql` + سه فایل rollback |
| اجراکننده | `scripts/migrate.ts` (`db:status`, `db:migrate`, `--dry-run`), دفتر `_hermiplan_migrations` با checksum SHA-256 |
| تراکنش | هر فایل در یک تراکنش |
| دستور مخرب | ندارد (بدون `DROP`/`RENAME`/`TRUNCATE` در مسیر ارتقا) |
| اجرا روی محیط شما | **انجام نشد** — هیچ اتصالی به پایگاه production یا staging شما برقرار نشد |
| اجرا روی محیط آزمون | **PostgreSQL 18.6 واقعی** (باینری `embedded-postgres`، بدون root/Docker) — سه پایگاه دورانداختنی: api-integration، سناریوی legacy، آزمون هم‌زمانی. قبلاً فقط PGlite بود |

### ۳-۴. آزمون روی PostgreSQL واقعی — چه چیزی سنجیده شد و چه چیزی نه

در این دور، باینری واقعی PostgreSQL (نسخه **۱۸٫۶**) از devDependency `embedded-postgres` اجرا شد و
همه‌چیز روی آن تکرار شد؛ شواهد: `docs/evidence/real-postgres.txt`، `api-integration.txt`،
`legacy-db.txt`، `db-integrity.txt`.

| مورد | نتیجه |
| --- | --- |
| سرور واقعی (نه PGlite) | `PostgreSQL 18.6 on x86_64-pc-linux-gnu` |
| `db:migrate` روی سرور واقعی | `0001` + `0002` + `0003` اعمال شد؛ `db:status` ⇒ «Schema is up to date» |
| یکپارچگی API روی سرور واقعی | **۶۷ موفق / ۰ ناموفق** (`api-integration-otp.txt`)؛ در حالت production بدون OTP: ۶۲/۰/۶ |
| مهاجرت پایگاه نسخه قبل | prepare → migrate → **۲۵ بررسی** → rollback ۰۰۰۳+۰۰۰۲ → **۶ بررسی** |
| هم‌زمانی محدودیت نرخ (۴۰ اتصال موازی) | دقیقاً ۱۰ درخواست مجاز، شمارنده نهایی ۴۰، هیچ شمارش گم‌شده |
| یکتایی هش توکن / FK / آبشاری‌شدن حذف | تأیید شد (از اتصال دوم، نه همان نشست) |
| `VALIDATE CONSTRAINT` روی FK مالکیت | موفق (۰ ردیف یتیم) و سپس ROLLBACK — هیچ تغییری باقی نماند |

مواردی که **هنوز** روی PostgreSQL واقعی آزموده نشده‌اند (و در بخش ۴ با ریسک آمده‌اند):

| مورد | چرا مهم است | وضعیت |
| --- | --- | --- |
| نسخه‌های ۱۵/۱۶/۱۷ (سرور شما) | سناریوی ما ۱۸٫۶ است؛ تفاوت‌های جزئی نحو/برنامه‌ریز ممکن است | ❌ آزموده نشده |
| pool واقعی provider (Neon/Supabase pooler) در serverless | رفتار pooler و سقف اتصال با یک نمونه محلی یکی نیست | ❌ |
| داده تولیدی شما (حجم، یتیم‌های تاریخی، ایندکس‌های موجود) | `VALIDATE CONSTRAINT` صفر یتیم دید، اما روی داده ما | ❌ (نیازمند نسخه staging شما) |
| پشتیبان‌گیری/بازگردانی واقعی (`pg_dump`/`pg_restore`) | مسیر بازگشت فاجعه | ❌ |

## ۴. کارهای باز و ریسک‌ها

| # | کار | وضعیت | ریسک اگر انجام نشود | پیش‌نیاز / تخمین |
| --- | --- | --- | --- | --- |
| ۱ | **مهاجرت Production** | ⛔ **متوقف تا تأیید صریح شما** | تغییر ناخواسته داده تولیدی | تأیید کتبی شما + بکاپ `pg_dump` + پنجره نگهداری. هیچ اقدامی انجام نشده است |
| ۲ | توکن اشتراک گزارش | ✅ **انجام شد** (این دور) | — | مهاجرت `0003` باید در production با تأیید شما اجرا شود (بند ۱) |
| ۳ | CSP سخت‌گیرانه | ✅ **انجام شد** (این دور، nonce + `strict-dynamic`) | `style-src` ناچار `'unsafe-inline'` است | سیاست با `npm run test:csp` روی هر deploy بررسی شود |
| ۴ | آزمون بصری موبایل/دسکتاپ و PDF چاپی | 🟡 **جزئی**: رندر پیکسلی نمودار + قواعد چاپ A4 + پیش‌شرط‌های چیدمان | چیدمان واقعی CSS در مرورگر دیده نشده | Chromium نیازمند `libnspr4`/`libnss3` و root برای `apt` — در CI با ایمیج کامل قابل اجراست |
| ۵ | ارسال واقعی پیامک | 🟡 مسیر کد آماده، ارسال آزمایش نشده | ممکن است قالب/پارامتر ارائه‌دهنده در عمل متفاوت باشد | کلید `SMS_PROVIDER_KEY` + `SMS_OTP_TEMPLATE` شما |
| ۶ | آزمون روی PostgreSQL واقعی | ✅ **انجام شد** روی ۱۸٫۶ (بخش ۳-۴) | نسخه شما ۱۵/۱۶/۱۷ و pooler provider | staging شما برای تکرار |
| ۷ | آزمون بار | 🟡 **محلی انجام شد**: ۱۹۴٫۸ req/s تحلیل، p95 ۹۲ms، ۰ خطا | ظرفیت Netlify (cold start، سقف هم‌زمانی، pool) سنجیده نشده | اجرای `npm run test:load` علیه preview deployment |
| ۸ | سیاست گرد کردن پول | ✅ **انجام شد** (`src/lib/engine/money.ts` + ۱۱ بررسی §۱۵) | — | — |
| ۹ | انواع «نمونه/شاخص» در مدل نرخ + ردیف واقعی فهرست‌بها | ❌ (عمدی) | ارقام قراردادی قابل استناد نیستند | سند رسمی فهرست‌بها ۱۴۰۵ + تأیید شما |
| ۱۰ | `VALIDATE CONSTRAINT` روی FK مالکیت | ✅ روی داده آزمون (۱۱ بررسی) | داده واقعی شما بررسی نشده | اجرای `npm run test:db:integrity` روی staging |
| ۱۱ | آزمون نفوذ مستقل | ❌ انجام‌نشده | ریسک باقی‌مانده پذیرش‌شده | تیم/ابزار مستقل |
| ۱۲ | ارزیابی امنیتی مرورگری CSP (گزارش نقض) | ❌ | `regex`/`style-src` می‌تواند در مرورگر واقعی نقض گزارش کند | اجرای مرورگر + `report-to` |

**قفل صریح:** بند ۱ (مهاجرت Production) تا دریافت تأیید شما **متوقف** است؛ در این دور هیچ فرمانی
علیه پایگاه داده production اجرا نشد.

---

## ۵. برای تصمیم پذیرش

در این دور، سه بند اصلی بخش ۴ (توکن اشتراک، CSP، آزمون PostgreSQL واقعی و هم‌زمانی) **پیاده و
آزموده شدند** و دو بند دیگر (سیاست پول، آزمون بار محلی) نیز بسته شدند. آنچه باقی می‌ماند واقعاً
وابسته به محیط بیرونی است:

| باقی‌مانده | دقیقاً چه چیزی کم است | چه کاری بدون آن ممکن است |
| --- | --- | --- |
| آزمون مرورگری/بصری | باینری Chromium + کتابخانه‌های `libnspr4`, `libnss3`, `libatk*`, `libgbm` (نصب نیازمند root/apt) | رندر SVG به پیکسل، قواعد چاپ، پیش‌شرط‌های چیدمان — انجام شد |
| ارسال واقعی پیامک | `SMS_PROVIDER_KEY` و `SMS_OTP_TEMPLATE` یک سرویس ایرانی | کل مسیر OTP با CSPRNG/هش/انقضا/تلاش/مصرف اتمیک آزموده شد |
| آزمون روی PostgreSQL شما | دسترسی به نسخه staging و `pg_dump` | کل مهاجرت/rollback روی PostgreSQL 18.6 واقعی آزموده شد |
| آزمون بار روی Netlify | یک preview deployment و ابزار بار | آزمون بار محلی با p95/p99 انجام شد |

اگر شواهد بالا کافی است، پذیرش فاز را تأیید کنید تا: (الف) مهاجرت production با بکاپ و پنجره
زمانی برنامه‌ریزی شود، (ب) بندهای باقی‌مانده بالا به‌عنوان فاز بعد آغاز شوند.

---

## پیوست: نگاشت «معیار ← فرمان تأیید»

```
npm ci            → docs/evidence/npm-ci.txt
npm run typecheck → docs/evidence/typecheck.txt
npm run lint      → docs/evidence/lint.txt
npm test          → docs/evidence/tests.txt
npm run test:api  → docs/evidence/api-integration.txt
npm run build     → docs/evidence/build.txt
db:migrate + legacy-db-check → docs/evidence/legacy-db.txt
next start + curl → docs/evidence/production-smoke.txt
```
