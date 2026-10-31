/**
 * HERMIPLAN — accessibility and mobile-readiness checks on the **served HTML**.
 *
 *   BASE_URL=http://127.0.0.1:3400 npx tsx scripts/a11y-check.ts
 *
 * Scope, stated honestly: this is a static analysis of the markup the server
 * returns. It catches the failures that actually block people — a document with
 * no language, unlabelled inputs, icon-only buttons with no accessible name,
 * images without `alt`, heading structure that skips levels, a viewport that
 * disables zoom — and it is *not* a substitute for running axe-core in a real
 * browser (still open work, see `docs/PROMPT-COMPLIANCE.md`).
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3400";
const PATHS = (process.env.A11Y_PATHS ?? "/,/builder").split(",").filter(Boolean);

let checks = 0;
let failures = 0;

function check(condition: boolean, message: string, detail = ""): void {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
}

/** Extremely small HTML attribute reader — enough for the checks below. */
function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main(): Promise<void> {
  for (const path of PATHS) {
    const response = await fetch(`${BASE}${path}`, { headers: { accept: "text/html" } });
    const html = await response.text();
    console.log(`▶ ${path} (${response.status}, ${Math.round(html.length / 1024)} KB)`);
    check(response.status === 200, "صفحه با کد ۲۰۰ پاسخ می‌دهد", `status=${response.status}`);

    // 1. document level
    check(/<html[^>]+lang="fa"/i.test(html), "زبان سند اعلام شده است (lang=\"fa\")");
    check(/<html[^>]+dir="rtl"/i.test(html), "جهت سند راست‌به‌چپ است (dir=\"rtl\")");
    const viewport = (html.match(/<meta[^>]+name="viewport"[^>]*>/i) ?? [])[0] ?? "";
    check(Boolean(viewport), "متای viewport وجود دارد");
    check(!/user-scalable=no|maximum-scale=1(?!\d)/i.test(viewport), "بزرگ‌نمایی موبایل مسدود نشده است", viewport);
    check(/<title>[^<]{3,}<\/title>/i.test(html), "عنوان صفحه وجود دارد");

    // 2. landmarks and headings
    check(/<main[\s>]/i.test(html), "ناحیه main وجود دارد");
    const headings = [...html.matchAll(/<h([1-6])[\s>]/gi)].map((match) => Number(match[1]));
    check(headings.filter((level) => level === 1).length === 1, "دقیقاً یک h1 وجود دارد", `h1=${headings.filter((l) => l === 1).length}`);
    let previous = 0;
    let skipped = 0;
    for (const level of headings) {
      if (previous && level > previous + 1) skipped += 1;
      previous = level;
    }
    check(skipped === 0, "ترتیب سرتیترها سطح پرش ندارد", `skips=${skipped}`);

    // 3. images and icons
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
    check(
      images.every((tag) => attribute(tag, "alt") !== null),
      "همه تصاویر alt دارند",
      `${images.filter((tag) => attribute(tag, "alt") === null).length} بدون alt`,
    );

    // 4. interactive elements need an accessible name
    const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)];
    let nameless = 0;
    for (const [, inner] of buttons) {
      const opening = html.slice(html.indexOf(inner) - 300, html.indexOf(inner));
      const hasLabel =
        textOf(inner).length > 0 ||
        /aria-label=|aria-labelledby=|title=/.test(opening.slice(-200));
      if (!hasLabel) nameless += 1;
    }
    check(nameless === 0, "همه دکمه‌ها نام قابل‌دسترس دارند", `${nameless} دکمه بدون نام`);

    // A control may be labelled three ways: aria-*, an explicit `<label for>`, or
    // by being nested inside a `<label>` (implicit association). All three are
    // valid; only a control with none of them is a real defect.
    const labelRanges: [number, number][] = [];
    for (const match of html.matchAll(/<label\b[\s\S]*?<\/label>/gi)) {
      labelRanges.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    }
    const inputs = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)];
    const inputIssues = inputs.filter((match) => {
      const tag = match[0];
      const hasAria = /aria-label=|aria-labelledby=/.test(tag);
      const id = attribute(tag, "id");
      const hasFor = id ? new RegExp(`<label[^>]+for="${id}"`, "i").test(html) : false;
      const position = match.index ?? 0;
      const hasImplicit = labelRanges.some(([start, end]) => position > start && position < end);
      const type = attribute(tag, "type");
      return !hasAria && !hasFor && !hasImplicit && type !== "hidden";
    });
    check(inputIssues.length === 0, "همه ورودی‌ها برچسب دارند", `${inputIssues.length} بدون برچسب`);

    // 5. things that break keyboard/AT users outright
    check(!/href="javascript:/i.test(html), "هیچ پیوند javascript: وجود ندارد");
    check(!/<div[^>]+onclick=/i.test(html), "هیچ div کلیک‌پذیر با onclick خام وجود ندارد");
    check(!/tabindex="[1-9]/i.test(html), "ترتیب تب مثبت (ضدالگو) استفاده نشده است");

    // 6. the RTL/mobile layout contract that CSS alone cannot guarantee
    check(!/<table[^>]+width="\d{4,}"/i.test(html), "جدول با عرض پیکسلی ثابت و بزرگ وجود ندارد");
  }

  console.log(
    failures === 0
      ? `\n✔ ${checks} بررسی دسترس‌پذیری/موبایل — همه موفق\n  تحلیل ایستای HTML سرو‌شده است، نه اجرای axe در مرورگر.`
      : `\n✘ ${failures} خطا از ${checks} بررسی`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
