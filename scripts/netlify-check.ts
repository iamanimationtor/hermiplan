/**
 * HERMIPLAN — Netlify deploy check.
 *
 *   npm run deploy:check                          # config + local build artifact
 *   npm run deploy:check -- --url https://…       # the same, plus live probes
 *   npm run deploy:check -- --url https://… --json
 *   npm run deploy:check -- --skip-build          # config only (no .next needed)
 *
 * Why this exists
 * ---------------
 * On 2026-11-06 the deployed site answered Netlify's own "Page not found" for
 * every URL. The deploy itself had succeeded: `https://<site>/BUILD_ID` and
 * `https://<site>/app-path-routes-manifest.json` both returned content, which
 * means the raw output of `next build` had been published as plain static
 * files. Nothing had turned that output into the serverless function and the
 * routing table that make `/`, `/builder` and `/api/*` answer, so Netlify had
 * no route to match.
 *
 * A plain `next build` alone can never serve this app. Netlify's Next.js
 * runtime (`@netlify/plugin-nextjs`) is what provisions the function and the
 * routes. This script checks, offline, that the configuration asks for that
 * runtime, and online, that a deployment actually answers — including the
 * fingerprints of the failure above, so the cause is named instead of guessed.
 *
 * Exit codes:
 *   0  clean — no blocker found
 *   1  blocker — see the BLOCKER lines and the remedy list
 *   2  usage / environment problem (bad --url, unreadable netlify.toml)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Level = "ok" | "warn" | "blocker";

interface Finding {
  level: Level;
  key: string;
  title: string;
  detail: string;
}

const root = process.cwd();
const findings: Finding[] = [];
const add = (level: Level, key: string, title: string, detail: string) => findings.push({ level, key, title, detail });

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const AS_JSON = process.argv.includes("--json");
const SKIP_BUILD = process.argv.includes("--skip-build");
const targetUrl = argValue("--url")?.replace(/\/+$/, "");

/** Persian remedy per finding key, printed once at the end. */
const REMEDIES: Record<string, string> = {
  config_missing:
    "netlify.toml در ریشهٔ مخزن نیست. بدون آن Netlify تنظیمات پیش‌فرض را حدس می‌زند و آداپتر Next اجرا نمی‌شود.",
  adapter_missing:
    "آداپتر Next در netlify.toml تعریف نشده است. بلوک [[plugins]] با package = \"@netlify/plugin-nextjs\" را اضافه کنید (همان‌طور که در netlify.toml این مخزن هست) و دوباره دیپلوی کنید.",
  adapter_not_installed:
    "@netlify/plugin-nextjs در package.json نیست. با `npm i -D @netlify/plugin-nextjs@5.16.6` نصب و کامیت کنید.",
  publish_mismatch:
    "publish باید \".next\" باشد. هر مقدار دیگری (out، public، dist، .next/static) یعنی Netlify یا خروجی خالی منتشر می‌کند یا فایل‌های خام بیلد را؛ نتیجه‌اش همین ۴۰۴ است.",
  build_command:
    "دستور بیلد باید `next build` را اجرا کند (اینجا: npm run build → next build). دستور دیگری مثل `next export` هیچ تابعی نمی‌سازد.",
  node_version:
    "NODE_VERSION در netlify.toml (و .nvmrc) باید ۲۲ باشد؛ Next 16 روی Node قدیمی بیلد نمی‌شود.",
  gitignore_build_output:
    ".next/ و .netlify/ باید در .gitignore باشند تا خروجی بیلد هرگز کامیت یا به‌عنوان سایت منتشر نشود.",
  build_artifact:
    "خروجی بیلد پیدا نشد. اول `npm run build` را اجرا کنید (یا --skip-build بدهید).",
  artifact_routes:
    "خروجی بیلد مسیر `/` را ندارد؛ بیلد ناقص است. کش را پاک و دوباره بیلد کنید.",
  static_404:
    "دامنهٔ مستقر «Page not found» خودِ Netlify را برمی‌گرداند: یعنی هنوز هیچ دیپلوی سالمی منتشر نشده یا مسیرها به تابع وصل نیستند. در پنل Netlify → Deploys: آخرین دیپلوی را باز کنید؛ اگر Build failed است لاگ را بخوانید، «Clear cache and deploy site» بزنید و از مخزن (git) دیپلوی کنید.",
  raw_next_publish:
    "خروجی خام next build به‌عنوان فایل استاتیک منتشر شده است (BUILD_ID و app-path-routes-manifest.json از ریشهٔ دامنه در دسترس‌اند). این دقیقاً همان حالتی است که همهٔ مسیرها ۴۰۴ می‌شوند. آداپتر را فعال کنید (netlify.toml این مخزن) و هرگز با `netlify deploy --dir=.next` دیپلوی نکنید؛ از دیپلوی متصل به گیت یا `netlify deploy --build --prod` استفاده کنید.",
  health_not_json:
    "پاسخ /api/health JSON نیست، پس درخواست به تابع Next نمی‌رسد؛ همان مشکل مسیر‌دهی است.",
  route_broken:
    "این مسیر پاسخ درست نمی‌دهد. اگر HTML «Page not found» برگردد مشکل مسیر‌دهی است؛ اگر ۵۰۰ باشد لاگ تابع را ببینید.",
};

// ── tiny TOML reader (enough for the keys we must verify) ─────────────────────
interface TomlInfo {
  build: Record<string, string>;
  buildEnv: Record<string, string>;
  pluginPackages: string[];
  hasDevSection: boolean;
}

function readToml(text: string): TomlInfo {
  const info: TomlInfo = { build: {}, buildEnv: {}, pluginPackages: [], hasDevSection: false };
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (/^\[\[.+\]\]$/.test(line)) {
      section = line.replace(/^\[\[|\]\]$/g, "").trim();
      continue;
    }
    if (/^\[.+\]$/.test(line)) {
      section = line.replace(/^\[|\]$/g, "").trim();
      if (section === "dev") info.hasDevSection = true;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .replace(/#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    if (section === "build") info.build[key] = value;
    else if (section === "build.environment") info.buildEnv[key] = value;
    else if (section === "plugins" && key === "package") info.pluginPackages.push(value);
  }
  return info;
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

// ── offline checks ───────────────────────────────────────────────────────────
const NETLIFY_TOML = join(root, "netlify.toml");
if (!existsSync(NETLIFY_TOML)) {
  add("blocker", "config_missing", "netlify.toml موجود نیست", "Netlify هیچ تنظیم صریحی برای بیلد و publish ندارد.");
} else {
  const toml = readToml(readFileSync(NETLIFY_TOML, "utf8"));
  const pkg = readJson<{ scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(join(root, "package.json"));

  const command = toml.build.command ?? "";
  const buildScript = pkg?.scripts?.build ?? "";
  if (command === "npm run build" && /(^|\s)next\s+build(\s|$)/.test(buildScript)) {
    add("ok", "build_command", "دستور بیلد", `${command} → ${buildScript} (خروجی کامل Next، نه next export)`);
  } else {
    add("blocker", "build_command", "دستور بیلد درست نیست", `[build] command = "${command}" و scripts.build = "${buildScript}"`);
  }

  const publish = toml.build.publish ?? "";
  if (publish === ".next") {
    add("ok", "publish", "پوشهٔ انتشار", 'publish = ".next" (مقدار مستندشده برای سایت Next.js)');
  } else {
    add("blocker", "publish_mismatch", "پوشهٔ انتشار اشتباه است", `publish = "${publish || "(خالی)"}" — باید ".next" باشد.`);
  }

  const adapterListed = toml.pluginPackages.includes("@netlify/plugin-nextjs");
  const adapterInstalled = Boolean(pkg?.devDependencies?.["@netlify/plugin-nextjs"] ?? pkg?.dependencies?.["@netlify/plugin-nextjs"]);
  if (adapterListed && adapterInstalled) {
    add("ok", "adapter", "آداپتر Next", "«@netlify/plugin-nextjs» هم در netlify.toml و هم در package.json است.");
  } else {
    if (!adapterListed) add("blocker", "adapter_missing", "آداپتر Next در netlify.toml نیست", "بدون آداپتر هیچ تابع و مسیری ساخته نمی‌شود ⇒ همهٔ آدرس‌ها ۴۰۴.");
    if (!adapterInstalled) add("blocker", "adapter_not_installed", "آداپتر Next نصب نشده", "package.json هیچ نسخه‌ای از @netlify/plugin-nextjs ندارد.");
  }

  const nodeVersion = toml.buildEnv.NODE_VERSION ?? "";
  const nvmrc = existsSync(join(root, ".nvmrc")) ? readFileSync(join(root, ".nvmrc"), "utf8").trim() : "";
  const nodeMajor = Number.parseInt(nodeVersion, 10);
  if (nodeMajor >= 22 && nvmrc === nodeVersion) {
    add("ok", "node_version", "نسخهٔ Node", `NODE_VERSION = "${nodeVersion}" و .nvmrc = "${nvmrc}"`);
  } else {
    add("warn", "node_version", "نسخهٔ Node هم‌تراز نیست", `NODE_VERSION = "${nodeVersion || "(خالی)"}" · .nvmrc = "${nvmrc || "(نیست)"}" · انتظار: ۲۲ در هر دو.`);
  }

  const depsNeeded = ["typescript", "@types/node", "@types/react", "@tailwindcss/postcss"];
  const missingDeps = depsNeeded.filter((dep) => !pkg?.devDependencies?.[dep] && !pkg?.dependencies?.[dep]);
  if (missingDeps.length === 0) {
    add("ok", "build_deps", "وابستگی‌های بیلد", `${depsNeeded.length} وابستگی لازم (typescript و …) در package.json هستند.`);
  } else {
    add("warn", "build_deps", "وابستگی بیلد کم است", `این‌ها نیستند: ${missingDeps.join(", ")} — اگر Netlify وابستگی‌های dev را نصب نکند بیلد شکست می‌خورد.`);
  }

  const gitignore = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
  const ignoresBuild = /^\.next\/?$/m.test(gitignore) && /^\.netlify\/?$/m.test(gitignore);
  if (ignoresBuild) {
    add("ok", "gitignore_build_output", "خروجی بیلد در گیت نیست", ".next/ و .netlify/ در .gitignore هستند.");
  } else {
    add("warn", "gitignore_build_output", "خروجی بیلد در .gitignore نیست", ".next/ یا .netlify/ در .gitignore پیدا نشد.");
  }

  const redirectsPath = join(root, "public", "_redirects");
  if (existsSync(redirectsPath)) {
    const redirects = readFileSync(redirectsPath, "utf8");
    const catchAll = redirects.split(/\r?\n/).some((line) => /^\s*\/\*\s/.test(line) && /404/.test(line));
    if (catchAll) {
      add("blocker", "redirects_catch_all", "public/_redirects مسیرها را می‌بلعد", "یک قاعدهٔ /* … 404 همهٔ مسیرها را قبل از تابع می‌گیرد؛ حذفش کنید.");
    } else {
      add("ok", "redirects", "public/_redirects", "قاعدهٔ سرتاسری ۴۰۴ ندارد.");
    }
  }

  if (toml.hasDevSection) {
    add("ok", "dev_section", "بخش [dev]", "netlify dev روی پورت ۳۰۰۰ به اپ وصل می‌شود.");
  }
}

if (!SKIP_BUILD) {
  const buildIdPath = join(root, ".next", "BUILD_ID");
  const manifestPath = join(root, ".next", "app-path-routes-manifest.json");
  if (!existsSync(buildIdPath) || !existsSync(manifestPath)) {
    add("blocker", "build_artifact", "خروجی بیلد نیست", "‎.next/BUILD_ID یا ‎.next/app-path-routes-manifest.json پیدا نشد.");
  } else {
    add("ok", "build_artifact", "خروجی بیلد", `BUILD_ID = ${readFileSync(buildIdPath, "utf8").trim()}`);
    const routes = readJson<Record<string, string>>(manifestPath) ?? {};
    const paths = Object.values(routes);
    const hasRoot = paths.includes("/");
    const hasApi = paths.some((path) => path.startsWith("/api/"));
    if (hasRoot && hasApi) {
      add("ok", "artifact_routes", "مسیرهای بیلد", `${paths.length} مسیر در مانیفست، شامل / و APIها.`);
    } else {
      add("blocker", "artifact_routes", "مسیرهای بیلد ناقص است", `مسیر ریشه: ${hasRoot ? "هست" : "نیست"} · مسیر API: ${hasApi ? "هست" : "نیست"}`);
    }
  }
}

// ── live probes ──────────────────────────────────────────────────────────────
interface Probe {
  status: number;
  contentType: string;
  body: string;
  ms: number;
}

async function probe(base: string, path: string): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "HERMIPLAN-deploy-check/1.0" },
    });
    const body = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: body.length > 8000 ? body.slice(0, 8000) : body,
      ms: Date.now() - started,
    };
  } catch (error) {
    // fetch() hides the useful part in `cause` (ENOTFOUND, EAI_AGAIN, ECONNREFUSED…).
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const reason = cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : String(error));
    return { status: 0, contentType: "", body: reason, ms: Date.now() - started };
  }
}

const isNetlify404 = (probeResult: Probe): boolean =>
  /answers\.netlify\.com\/t\/support-guide/i.test(probeResult.body) ||
  (/page not found/i.test(probeResult.body) && /netlify/i.test(probeResult.body) && !/HERMIPLAN/i.test(probeResult.body));

async function liveChecks(base: string): Promise<void> {
  const home = await probe(base, "/");
  if (home.status === 0) {
    // No answer at all: this machine (or CI runner) cannot reach the site.
    // Probing the remaining paths would only repeat the same error, so stop
    // here and say what happened instead of reporting a false routing failure.
    add("warn", "network_unreachable", "بررسی زنده انجام نشد", `اتصال به ${base} برقرار نشد (${home.body}). این وضعیت دربارهٔ تنظیمات سایت هیچ نمی‌گوید؛ از شبکه‌ای اجرا کنید که به دامنه دسترسی دارد.`);
    return;
  }
  if (home.status === 200 && /HERMIPLAN/i.test(home.body) && /lang="fa"/i.test(home.body)) {
    add("ok", "live_home", "صفحهٔ اصلی", `۲۰۰ در ${home.ms}ms — صفحهٔ فارسی HERMIPLAN`);
  } else if (isNetlify404(home)) {
    add("blocker", "static_404", "صفحهٔ اصلی ۴۰۴ خودِ Netlify است", `وضعیت ${home.status} — HTML «Page not found» نتلیفای`);
  } else {
    add("blocker", "route_broken", "صفحهٔ اصلی پاسخ درست نمی‌دهد", `وضعیت ${home.status} · ${home.contentType} · ${home.body.slice(0, 160).replace(/\s+/g, " ")}`);
  }

  const buildId = await probe(base, "/BUILD_ID");
  const manifest = await probe(base, "/app-path-routes-manifest.json");
  if (buildId.status === 200 || manifest.status === 200) {
    add(
      "blocker",
      "raw_next_publish",
      "خروجی خام next build منتشر شده است",
      `/BUILD_ID → ${buildId.status} · /app-path-routes-manifest.json → ${manifest.status} — یعنی پوشهٔ .next به‌عنوان فایل استاتیک سرو می‌شود، نه از طریق آداپتر`,
    );
  } else {
    add("ok", "raw_next_publish", "خروجی بیلد خام منتشر نشده", `/BUILD_ID → ${buildId.status} · مانیفست مسیرها → ${manifest.status}`);
  }

  const health = await probe(base, "/api/health");
  const healthIsJson = /application\/json/i.test(health.contentType);
  if (healthIsJson && health.status < 500) {
    const parsed = ((): Record<string, unknown> | undefined => {
      try {
        return JSON.parse(health.body) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    })();
    const summary = parsed ? `ok=${String(parsed.ok)} · schema=${String(parsed.schemaVersion ?? "?")} · database=${String(parsed.database ?? "?")}` : "بدنه JSON نامعتبر";
    add("ok", "health", "/api/health", `${health.status} در ${health.ms}ms — ${summary}`);
  } else if (isNetlify404(health)) {
    add("blocker", "health_not_json", "/api/health به Netlify ۴۰۴ می‌خورد", "هیچ تابعی برای API وجود ندارد (همان مشکل مسیر‌دهی)");
  } else {
    add("blocker", "health_not_json", "/api/health پاسخ JSON نمی‌دهد", `وضعیت ${health.status} · ${health.contentType} · ${health.body.slice(0, 160).replace(/\s+/g, " ")}`);
  }

  const builder = await probe(base, "/builder");
  if (builder.status === 200 && /HERMIPLAN|lang="fa"/i.test(builder.body)) {
    add("ok", "builder", "/builder", `۲۰۰ در ${builder.ms}ms`);
  } else if (isNetlify404(builder)) {
    add("blocker", "route_broken", "/builder به ۴۰۴ نتلیفای می‌خورد", "مسیرهای صفحه هم به تابع وصل نیستند");
  } else {
    add("warn", "route_broken", "/builder پاسخ مورد انتظار را نداد", `وضعیت ${builder.status}`);
  }

  for (const path of ["/robots.txt", "/sitemap.xml"]) {
    const result = await probe(base, path);
    if (result.status === 200) add("ok", `route:${path}`, path, `۲۰۰ در ${result.ms}ms · ${result.contentType}`);
    else add("warn", `route:${path}`, path, `وضعیت ${result.status} — این مسیر هم باید از سمت اپ پاسخ بگیرد`);
  }

  const projects = await probe(base, "/api/projects");
  const projectsJson = /application\/json/i.test(projects.contentType);
  if (projectsJson && projects.status >= 400 && projects.status < 500) {
    add("ok", "api_projects", "/api/projects بدون کوکی", `${projects.status} — محافظت‌شده و JSON`);
  } else if (isNetlify404(projects)) {
    add("blocker", "route_broken", "/api/projects به ۴۰۴ نتلیفای می‌خورد", "API اصلاً به تابع وصل نیست");
  } else {
    add("warn", "api_projects", "/api/projects", `وضعیت ${projects.status} · ${projects.contentType}`);
  }
}

async function main(): Promise<void> {
  if (targetUrl) {
    if (!/^https?:\/\//i.test(targetUrl)) {
      console.error("--url باید با http:// یا https:// شروع شود.");
      process.exit(2);
    }
    await liveChecks(targetUrl);
  }

  const blockers = findings.filter((finding) => finding.level === "blocker");
  const warnings = findings.filter((finding) => finding.level === "warn");
  const unreachable = findings.some((finding) => finding.key === "network_unreachable");

  if (AS_JSON) {
    console.log(JSON.stringify({ url: targetUrl ?? null, findings, blockers: blockers.length, warnings: warnings.length, live: !unreachable }, null, 2));
  } else {
    console.log("HERMIPLAN — بررسی دیپلوی Netlify");
    if (targetUrl) console.log(`هدف: ${targetUrl}`);
    console.log("");
    for (const finding of findings) {
      const mark = finding.level === "ok" ? "✓" : finding.level === "warn" ? "⚠" : "✗";
      console.log(`${mark} ${finding.title}`);
      console.log(`   ${finding.detail}`);
    }
    if (blockers.length > 0) {
      console.log("\n — راه‌حل‌ها —");
      for (const key of [...new Set(blockers.map((finding) => finding.key))]) {
        console.log(` • ${REMEDIES[key] ?? "این مورد را در docs/NETLIFY-DEPLOY.md ببینید."}`);
      }
      console.log("\nمستند کامل: docs/NETLIFY-DEPLOY.md");
    }
    const verdict = blockers.length > 0 ? `${blockers.length} مانع` : unreachable ? "بررسی زنده انجام نشد" : "همه‌چیز درست است";
    console.log(`\n${verdict} · ${warnings.length} هشدار · ${findings.length} بررسی`);
  }

  if (blockers.length > 0) process.exit(1);
  process.exit(unreachable ? 2 : 0);
}

void main();
