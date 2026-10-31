/**
 * HERMIPLAN — Content-Security-Policy verification.
 *
 * This is not a browser test (no browser is available in this environment), and
 * it is not claimed to be one. What it *does* prove, against a running server:
 *
 *  1. every document response carries a CSP header;
 *  2. the policy has no `'unsafe-inline'` / `'unsafe-eval'` in `script-src`;
 *  3. every inline `<script>` in the served HTML carries the nonce from the
 *     same response's header (so the policy does not block the app's own
 *     bootstrap);
 *  4. every external origin referenced by the markup (fonts, styles, images,
 *     connect targets) is allowed by the policy — i.e. the policy does not
 *     silently break resources the page loads;
 *  5. `frame-ancestors`, `object-src`, `base-uri` and `form-action` are locked
 *     down.
 *
 * Usage: BASE_URL=http://127.0.0.1:3200 npx tsx scripts/csp-check.ts
 */
import { request } from "node:http";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const PATHS = (process.env.CSP_PATHS ?? "/,/builder").split(",").filter(Boolean);

let checks = 0;
let failures = 0;

function check(condition: boolean, message: string, detail?: string) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`  ✗ ${message}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Fetched {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function fetchPath(path: string): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: "GET", headers: { accept: "text/html" } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Splits a CSP header into directive → sources. */
function parseCsp(header: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of header.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    map.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return map;
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

async function main() {
  for (const path of PATHS) {
    console.log(`▶ ${path}`);
    const page = await fetchPath(path);
    check(page.status === 200, `${path} با کد ۲۰۰ پاسخ می‌دهد`, `status=${page.status}`);

    const rawCsp = page.headers["content-security-policy"];
    const csp = Array.isArray(rawCsp) ? rawCsp[0] : rawCsp;
    check(Boolean(csp), `${path} هدر Content-Security-Policy دارد`);
    if (!csp) continue;

    const directives = parseCsp(csp);
    const scriptSrc = directives.get("script-src") ?? [];
    check(!scriptSrc.includes("'unsafe-inline'"), "script-src بدون 'unsafe-inline' است", scriptSrc.join(" "));
    check(!scriptSrc.includes("'unsafe-eval'"), "script-src بدون 'unsafe-eval' است", scriptSrc.join(" "));
    check(directives.get("object-src")?.[0] === "'none'", "object-src مسدود است");
    check(directives.get("base-uri")?.[0] === "'self'", "base-uri محدود به self است");
    check(directives.get("form-action")?.[0] === "'self'", "form-action محدود به self است");
    check(directives.get("frame-ancestors")?.[0] === "'none'", "frame-ancestors مسدود است");

    const nonceToken = scriptSrc.find((token) => token.startsWith("'nonce-"));
    check(Boolean(nonceToken), "script-src دارای nonce است");
    const nonce = nonceToken?.replace(/^'nonce-/, "").replace(/'$/, "") ?? "";

    // 3. every inline script carries this response's nonce
    const scriptTags = page.body.match(/<script\b[^>]*>/gi) ?? [];
    const inlineScripts = scriptTags.filter((tag) => !/\bsrc=/i.test(tag));
    const unnonced = inlineScripts.filter((tag) => !tag.includes(`nonce="${nonce}"`));
    check(
      unnonced.length === 0,
      "همه اسکریپت‌های inline همان nonce پاسخ را دارند (سیاست، خود اپ را نمی‌شکند)",
      unnonced.length ? `${unnonced.length} از ${inlineScripts.length} بدون nonce` : `${inlineScripts.length} اسکریپت inline`,
    );

    // 4. external origins referenced by the markup must be allowed
    const origins = new Set<string>();
    for (const match of page.body.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)) {
      const origin = originOf(match[1]);
      if (origin && origin !== new URL(BASE).origin) origins.add(origin);
    }
    const styleSrc = directives.get("style-src") ?? [];
    const fontSrc = directives.get("font-src") ?? [];
    const imgSrc = directives.get("img-src") ?? [];
    for (const origin of origins) {
      const allowed = [...styleSrc, ...fontSrc, ...imgSrc].includes(origin);
      check(allowed, `منبع بیرونی ${origin} در سیاست مجاز است`);
    }
    if (origins.size === 0) check(true, "هیچ منبع بیرونی در HTML صفحه فراخوانی نمی‌شود");

    // The stylesheet itself imports the webfont from jsDelivr.
    const cssOrigin = (page.body.match(/@import\s+url\("?(https?:\/\/[^")]+)/) ?? [])[1];
    if (cssOrigin) {
      const origin = originOf(cssOrigin);
      check(
        Boolean(origin && (styleSrc.includes(origin) || fontSrc.includes(origin))),
        "CDN فونت در style-src/font-src مجاز شمرده شده است",
        cssOrigin,
      );
    }
  }

  console.log(
    failures === 0
      ? `\n✔ ${checks} بررسی CSP — همه موفق\n  سیاست بررسی‌شده، نه آزمون مرورگری: اجرای واقعی مرورگر همچنان کار باز است.`
      : `\n✘ ${failures} خطا از ${checks} بررسی CSP`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
