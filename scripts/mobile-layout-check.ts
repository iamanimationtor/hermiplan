/**
 * HERMIPLAN — real-browser mobile layout guard.
 *
 * Why this exists
 * ---------------
 * The phone layout broke in a way that no static check could see: the shared
 * `Button` hard-coded `inline-flex`, which silently beat every `hidden` the
 * caller passed. Three "desktop only" buttons therefore stayed visible, the
 * builder header grew to ~403px on a 390px phone, the document became 419px
 * wide, and the `position: fixed` bottom step bar — laid out against the
 * document width — slid sideways until «مرحله بعد» was off-screen. Every page
 * of the wizard looked wrong, for the same one reason.
 *
 * Static audits (`scripts/layout-audit.ts`) can now detect the *cause* in the
 * source, but only a real engine measures the *effect*: document width vs.
 * viewport, fixed bars vs. the viewport, and controls that end up off-screen.
 *
 * Usage
 * -----
 *   npm run test:mobile                       # uses http://127.0.0.1:3000
 *   BASE_URL=http://127.0.0.1:3100 npm run test:mobile
 *   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium npm run test:mobile
 *
 * Without a running server (or without Chromium + puppeteer-core) the suite
 * reports the checks as *skipped* and exits 0 — same policy as `export-check`
 * without `BASE_URL`. It never pretends to have verified something it did not.
 *
 * Checks, per width in 320 / 360 / 390 / 414 px:
 *   1. `document.scrollWidth === viewport` — no horizontal overflow anywhere.
 *   2. every `position: fixed` bar is flush with the viewport's left and right
 *      edges (this is the exact symptom of the reported bug).
 *   3. no visible control (button/link/input) has any part outside the viewport
 *      and outside a horizontal scroller.
 *   4. the builder's bottom bar is visible and inside the viewport on every one
 *      of the six steps, and its «مرحله بعد» button is fully tappable.
 *   5. the last block of content on each step clears the fixed bar when the page
 *      is scrolled to the bottom (nothing is buried under it).
 *   6. `?account=1` opens exactly one sign-in dialog and its panel really paints
 *      inside the viewport — the class of bug where a `<dialog>` is nested in a
 *      `display:none` wrapper and renders at 0×0 while the DOM looks right.
 *   7. the same dialog opens from the action bar's 👤 / the header trigger.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const BASE = process.env.BASE_URL ?? process.env.BASE ?? "http://127.0.0.1:3000";
const WIDTHS = [320, 360, 390, 414];
const HEIGHT = 844;

let checks = 0;
let failures = 0;

function check(condition: boolean, message: string, detail?: string) {
  checks += 1;
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures += 1;
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

async function serverUp(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/builder`, { signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Locates a Chromium binary without assuming one particular packaging. */
function resolveChromium(): string | null {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;
  for (const candidate of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const probe = spawnSync("which", [candidate], { encoding: "utf8" });
    if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
  }
  return null;
}

/**
 * In-page probe, passed to `page.evaluate` **as source text** (plain JavaScript,
 * no TypeScript syntax).
 *
 * Why a string: `puppeteer.evaluate(fn)` serialises the function; when the file
 * runs through `tsx`, esbuild's `keepNames` helper (`__name`) ends up inside the
 * serialised closure and the page throws `__name is not defined`. A source
 * string carries no bundler helpers, and staying plain JS keeps it runnable.
 *
 * Reports the measured layout facts the phone bug used to break: the document
 * width, any `position: fixed` box that is not flush with the viewport, visible
 * controls outside the viewport, and the builder's bottom bar geometry.
 */
const PROBE_SOURCE = `(function probe() {
  const vw = document.documentElement.clientWidth;
  const contained = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/(hidden|auto|scroll|clip)/.test(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  const fixedOffsets = [];
  document.querySelectorAll("*").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.display === "none") return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.left) > 1 || Math.abs(r.right - vw) > 1) {
      fixedOffsets.push({
        label: el.getAttribute("aria-label") || (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 24),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
    }
  });
  const offscreen = [];
  document.querySelectorAll("button, a[href], input, select, textarea").forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.closest(".sr-only")) return;
    if (contained(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.left < -0.5 || r.right > vw + 0.5) {
      offscreen.push({
        label: (el.getAttribute("aria-label") || (el.textContent || "").trim() || el.getAttribute("placeholder") || "?").slice(0, 26),
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  });
  const bar = document.querySelector("[data-hp-actionbar]");
  const barRect = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect() : null;
  const next = bar
    ? Array.from(bar.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "مرحله بعد")
    : null;
  const nextRect = next ? next.getBoundingClientRect() : null;
  const lastBlock = barRect
    ? Array.from((bar && bar.parentElement ? bar.parentElement.querySelectorAll("main > div > *") : [])).pop()
    : undefined;
  return {
    vw,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    fixedOffsets,
    offscreen,
    bar: barRect && {
      left: Math.round(barRect.left),
      right: Math.round(barRect.right),
      top: Math.round(barRect.top),
    },
    next: nextRect && {
      left: Math.round(nextRect.left),
      right: Math.round(nextRect.right),
      inside: nextRect.left >= -0.5 && nextRect.right <= vw + 0.5,
    },
    lastBlockBottom: lastBlock ? Math.round(lastBlock.getBoundingClientRect().bottom) : null,
  };
})()`;

/**
 * Measures the visible sign-in dialog. Kept as a plain JS string for the same
 * reason as `PROBE_SOURCE`: esbuild's `keepNames` wraps function expressions in
 * a `__name` helper that does not exist in the page.
 */
const DIALOG_PROBE = `(() => {
  const dialogs = Array.from(document.querySelectorAll('[aria-modal="true"]'));
  const dialog = dialogs[0] || null;
  if (!dialog) return { count: dialogs.length, panel: null, inside: false, closeTappable: false, close: null };
  const panelEl = dialog.firstElementChild;
  const closeEl = dialog.querySelector('button[aria-label="بستن"]');
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const panel = rect(panelEl);
  const close = rect(closeEl);
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const inside = !!panel && panel.x >= -0.5 && panel.y >= -0.5 && panel.x + panel.width <= vw + 0.5 && panel.y + panel.height <= vh + 0.5;
  const closeTappable = !!close && close.width >= 20 && close.height >= 20 && close.x >= 0 && close.x + close.width <= vw;
  return { count: dialogs.length, label: dialog.getAttribute('aria-label'), panel, inside, closeTappable, close };
})()`;

/**
 * Report page: header actions must fit on one line, the phone gets the «⋯»
 * door instead of clipped buttons, and nothing may hang off the viewport.
 * X-axis tabs live in their own `overflow-x-auto` strip, so they are excluded.
 */
const REPORT_PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const bar = document.querySelector('.no-print.sticky');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const scroller = (el) => {
    let node = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
      node = node.parentElement;
    }
    return false;
  };
  const actions = bar
    ? Array.from(bar.querySelectorAll('button')).filter((b) => visible(b) && !scroller(b))
        .map((b) => (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    : [];
  const offscreen = [];
  if (bar) {
    for (const el of bar.querySelectorAll('button, a, input')) {
      if (!visible(el) || scroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.right > vw + 0.5) offscreen.push({ text: (el.innerText || '').trim().slice(0, 16), rect: [Math.round(r.left), Math.round(r.right)] });
    }
  }
  const more = Array.from(document.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'کارهای بیشتر گزارش');
  return {
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    actions,
    phoneMore: !!more && visible(more),
    offscreen,
  };
})()`;

async function main() {
  console.log("▶ آزمون چیدمان موبایل در مرورگر واقعی\n");

  if (!(await serverUp())) {
    console.log(`  ⚠ سروری روی ${BASE} پاسخ نمی‌دهد — آزمون رد شد (skipped).`);
    console.log("     برای اجرا: npm run build && npx next start -p 3000، سپس npm run test:mobile");
    process.exit(0);
  }

  const executablePath = resolveChromium();
  if (!executablePath) {
    console.log("  ⚠ Chromium پیدا نشد — آزمون مرورگری رد شد (skipped).");
    console.log("     PUPPETEER_EXECUTABLE_PATH=/path/to/chromium npm run test:mobile");
    process.exit(0);
  }

  let puppeteer: any;
  try {
    // Optional dependency, resolved at runtime so the suite degrades to
    // "skipped" instead of failing to load. `createRequire` follows NODE_PATH
    // and nested node_modules correctly, and the dynamic `import()` of the
    // resolved path avoids a static reference tsc/eslint would try to type.
    const requireFromProject = createRequire(`${process.cwd()}/package.json`);
    const entry = requireFromProject.resolve("puppeteer-core");
    const load: (specifier: string) => Promise<{ default?: any }> = new Function("s", "return import(s)") as never;
    puppeteer = (await load(entry)).default;
  } catch {
    console.log("  ⚠ puppeteer-core نصب نیست — آزمون مرورگری رد شد (skipped).");
    process.exit(0);
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    for (const width of WIDTHS) {
      console.log(`\n▶ عرض ${width} پیکسل`);
      const page = await browser.newPage();
      await page.setViewport({ width, height: HEIGHT, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

      // Landing page first: it shares the header patterns (logo, sign-in, menu).
      await page.goto(`${BASE}/`, { waitUntil: "networkidle2", timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 800));
      let info = await page.evaluate(PROBE_SOURCE);
      check(info.docScrollW === width && info.bodyScrollW === width, "صفحهٔ اصلی عرض افقی اضافه ندارد", `doc=${info.docScrollW} body=${info.bodyScrollW} vw=${width}`);
      check(info.fixedOffsets.length === 0, "نوارهای ثابت صفحهٔ اصلی با لبهٔ نمایشگر هم‌ترازند", JSON.stringify(info.fixedOffsets));
      check(info.offscreen.length === 0, "هیچ کنترل صفحهٔ اصلی بیرون از نمایشگر نیست", JSON.stringify(info.offscreen));

      // Builder: all six steps, including the bar geometry on each one.
      await page.goto(`${BASE}/builder`, { waitUntil: "networkidle2", timeout: 60_000 });
      await page.evaluate(() => localStorage.setItem("hermiplan:welcomed", "1"));
      await page.reload({ waitUntil: "networkidle2" });
      await new Promise((r) => setTimeout(r, 1500));

      for (let step = 0; step < 6; step += 1) {
        info = await page.evaluate(PROBE_SOURCE);
        check(
          info.docScrollW === width && info.bodyScrollW === width,
          `مرحله ${step + 1}: عرض سند برابر نمایشگر است`,
          `doc=${info.docScrollW} body=${info.bodyScrollW} vw=${width}`,
        );
        check(info.fixedOffsets.length === 0, `مرحله ${step + 1}: نوار اقدام موبایل کامل داخل نمایشگر است`, JSON.stringify(info.fixedOffsets));
        check(info.offscreen.length === 0, `مرحله ${step + 1}: هیچ کنترلی بیرون از نمایشگر نیست`, JSON.stringify(info.offscreen));
        check(
          Boolean(info.bar && info.bar.left === 0 && info.bar.right === width),
          `مرحله ${step + 1}: نوار پایین از لبهٔ چپ تا راست کشیده شده`,
          JSON.stringify(info.bar),
        );
        if (step < 5) {
          check(Boolean(info.next?.inside), `مرحله ${step + 1}: دکمهٔ «مرحله بعد» کاملاً قابل لمس است`, JSON.stringify(info.next));
        }

        // Bottom-of-page clearance: nothing may hide under the fixed bar.
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
        await new Promise((r) => setTimeout(r, 250));
        const bottom = await page.evaluate(PROBE_SOURCE);
        check(
          bottom.lastBlockBottom !== null && bottom.bar !== null && bottom.lastBlockBottom <= bottom.bar.top,
          `مرحله ${step + 1}: آخرین بخش محتوا زیر نوار پایین پنهان نمی‌شود`,
          `lastBottom=${bottom.lastBlockBottom} barTop=${bottom.bar?.top}`,
        );

        if (step < 5) {
          const advanced = await page.evaluate(() => {
            const bar = document.querySelector("[data-hp-actionbar]");
            const button = bar
              ? Array.from(bar.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "مرحله بعد")
              : null;
            if (!button) return false;
            button.click();
            return true;
          });
          if (!advanced) {
            check(false, `مرحله ${step + 1}: دکمهٔ «مرحله بعد» یافت نشد`);
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      // ---- sign-in dialog: one panel, painted inside the viewport ----------
      // Mark the tour as seen *first*: the sign-in deep link suppresses the
      // welcome panel, and this check is about the sign-in dialog only. (The
      // parameter is consumed on arrival — `history.replaceState` drops it so a
      // reload does not reopen the panel — so the link must be a fresh visit.)
      await page.evaluate(() => localStorage.setItem("hermiplan:welcomed", "1"));
      await page.goto(`${BASE}/builder?account=1`, { waitUntil: "networkidle2", timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 1200));
      let dialog = await page.evaluate(DIALOG_PROBE);
      check(dialog.count === 1, "لینک «ورود» فقط یک دیالوگ باز می‌کند", JSON.stringify(dialog));
      check(
        Boolean(dialog.panel && dialog.panel.width > 200 && dialog.panel.height > 120),
        "دیالوگ ورود واقعاً رندر می‌شود (نه ۰×۰ داخل ظرف مخفی)",
        JSON.stringify(dialog.panel),
      );
      check(Boolean(dialog.inside), "دیالوگ ورود کامل داخل نمایشگر است", JSON.stringify(dialog.panel));
      check(Boolean(dialog.closeTappable), "دکمهٔ بستن دیالوگ ورود قابل لمس است", JSON.stringify(dialog.close));

      // Close it, then reopen from whichever trigger this width shows.
      await page.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 400));
      dialog = await page.evaluate(DIALOG_PROBE);
      check(dialog.count === 0, "بستن دیالوگ ورود با Escape کار می‌کند", JSON.stringify(dialog));

      const trigger = await page.evaluate(() => {
        const candidates = [
          "[data-hp-actionbar] button[aria-label=\"ورود / ثبت‌نام\"]",
          "[data-hp-actionbar] button[aria-label=\"حساب کاربری\"]",
          "header button",
        ];
        for (const selector of candidates) {
          const button = document.querySelector<HTMLElement>(selector);
          if (!button) continue;
          const rect = button.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) continue;
          button.click();
          return selector;
        }
        return null;
      });
      await new Promise((r) => setTimeout(r, 600));
      dialog = await page.evaluate(DIALOG_PROBE);
      check(
        Boolean(trigger) && dialog.count === 1 && Boolean(dialog.inside),
        "باز کردن دوبارهٔ دیالوگ ورود از تریگر همین عرض کار می‌کند",
        `${trigger} → ${JSON.stringify(dialog)}`,
      );

      // ---- report page (needs a database; skipped cleanly without one) -----
      const reportPath = await page.evaluate(async () => {
        try {
          const response = await fetch("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "بررسی چیدمان گزارش", template: "construction" }),
          });
          if (!response.ok) return null;
          const data = await response.json();
          return `/report/${data.id}?k=${data.viewKey}`;
        } catch {
          return null;
        }
      });
      if (reportPath) {
        await page.goto(`${BASE}${reportPath}`, { waitUntil: "networkidle2", timeout: 60_000 });
        await new Promise((r) => setTimeout(r, 1200));
        const report = await page.evaluate(REPORT_PROBE);
        check(
          report.doc === width && report.body === width,
          "صفحهٔ گزارش عرض افقی اضافه ندارد",
          `doc=${report.doc} body=${report.body} vw=${width}`,
        );
        check(report.offscreen.length === 0, "هیچ کنترل صفحهٔ گزارش بیرون از نمایشگر نیست", JSON.stringify(report.offscreen));
        check(
          report.phoneMore === (width < 768),
          width < 768 ? "گزارش در موبایل دکمهٔ «بیشتر» را نشان می‌دهد" : "گزارش در تبلت/دسکتاپ اکشن‌ها را مستقیم نشان می‌دهد",
          `more=${report.phoneMore} actions=[${report.actions.join(", ")}]`,
        );
        check(
          report.actions.length >= 2 && report.actions.length <= (width < 768 ? 3 : 6),
          "تعداد اکشن‌های سرصفحهٔ گزارش با عرض صفحه هم‌خوان است",
          `count=${report.actions.length}`,
        );
        if (width < 768) {
          const opened = await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === "کارهای بیشتر گزارش");
            if (!button) return false;
            button.click();
            return true;
          });
          await new Promise((r) => setTimeout(r, 600));
          const sheet = await page.evaluate(DIALOG_PROBE);
          check(
            opened && sheet.count === 1 && Boolean(sheet.inside) && (sheet.panel?.width ?? 0) > 200,
            "شیت «کارهای بیشتر» گزارش باز و کامل داخل نمایشگر است",
            JSON.stringify(sheet),
          );
          await page.keyboard.press("Escape");
        }
      } else {
        console.log("  ⚠ گزارش بررسی نشد: ساخت پروژه ممکن نبود (بدون پایگاه داده) — این بخش رد شد (skipped).");
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(
    failures === 0
      ? `\n✔ ${checks} بررسی چیدمان موبایل در مرورگر واقعی — همه موفق`
      : `\n✘ ${failures} خطا از ${checks} بررسی چیدمان موبایل`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
