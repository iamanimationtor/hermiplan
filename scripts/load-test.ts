/**
 * HERMIPLAN — local load test (no external service, no extra dependency).
 *
 * Measures what one machine serving this build can do, using only Node's HTTP
 * client. Two mixes are measured:
 *
 *   • `analyze` — POST /api/analyze with a real project payload (CPU-bound:
 *     the CPM engine plus EVM);
 *   • `page`    — GET /builder (server render + middleware + CSP nonce).
 *
 * Honest scope: this is a single-process measurement on a sandbox CPU, not a
 * capacity guarantee for Netlify (serverless functions have their own limits,
 * cold starts, and concurrency caps). The numbers are reported with the machine
 * they were produced on, and the script is the artifact that lets anyone
 * reproduce them on the target infrastructure.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3400 npx tsx scripts/load-test.ts
 *   CONCURRENCY=16 DURATION_MS=10000 BASE_URL=… npx tsx scripts/load-test.ts
 */
import { request } from "node:http";
import { buildProjectFromTemplate } from "../src/lib/templates";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3400";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 12);
const DURATION_MS = Number(process.env.DURATION_MS ?? 8000);
const CLIENT_IP = process.env.LOAD_CLIENT_IP ?? "10.77.0.1";

const project = buildProjectFromTemplate("construction");
// A mid-sized project: enough activities that the scheduler does real work.
const payload = JSON.stringify({ project });
const payloadBytes = Buffer.byteLength(payload, "utf8");

interface Sample {
  ms: number;
  ok: boolean;
  status: number;
}

function requestOnce(path: string, method: "GET" | "POST", body?: string): Promise<Sample> {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const started = process.hrtime.bigint();
    const req = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
        headers: {
          "x-forwarded-for": CLIENT_IP,
          ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          resolve({ ms, ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400, status: res.statusCode ?? 0 });
        });
      },
    );
    req.on("error", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ms, ok: false, status: 0 });
    });
    if (body) req.write(body);
    req.end();
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function run(label: string, path: string, method: "GET" | "POST", body?: string): Promise<Sample[]> {
  const samples: Sample[] = [];
  const deadline = Date.now() + DURATION_MS;

  async function worker() {
    while (Date.now() < deadline) {
      samples.push(await requestOnce(path, method, body));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const latencies = samples.map((s) => s.ms).sort((a, b) => a - b);
  const failed = samples.filter((s) => !s.ok);
  const throughput = samples.length / (DURATION_MS / 1000);

  console.log(`▶ ${label}`);
  console.log(`   درخواست: ${samples.length} · موفق: ${samples.length - failed.length} · ناموفق: ${failed.length}`);
  console.log(
    `   تأخیر (ms): p50=${percentile(latencies, 50).toFixed(1)} p95=${percentile(latencies, 95).toFixed(1)} ` +
      `p99=${percentile(latencies, 99).toFixed(1)} max=${Math.max(...latencies).toFixed(1)}`,
  );
  console.log(`   توان عبور: ${throughput.toFixed(1)} درخواست/ثانیه با هم‌زمانی ${CONCURRENCY}`);
  if (failed.length) {
    const statuses = new Map<number, number>();
    for (const sample of failed) statuses.set(sample.status, (statuses.get(sample.status) ?? 0) + 1);
    console.log(`   کدهای خطا: ${[...statuses.entries()].map(([code, count]) => `${code}×${count}`).join(", ")}`);
  }
  return samples;
}

async function main() {
  console.log(`▶ آزمون بار محلی — ${BASE}`);
  console.log(`   حجم بدنه: ${(payloadBytes / 1024).toFixed(1)} KB · هم‌زمانی: ${CONCURRENCY} · مدت هر سنجش: ${DURATION_MS} ms`);
  console.log(`   node ${process.version} · ${process.platform}/${process.arch}\n`);

  const analyze = await run("POST /api/analyze (موتور CPM + EVM)", "/api/analyze", "POST", payload);
  const page = await run("GET /builder (SSR + CSP nonce)", "/builder", "GET");

  const all = [...analyze, ...page];
  const failures = all.filter((s) => !s.ok).length;
  console.log(
    failures === 0
      ? `\n✔ آزمون بار پایان یافت — ${all.length} درخواست، بدون خطا\n  این عدد ظرفیت یک پروسه روی این ماشین است، نه تضمین ظرفیت Netlify.`
      : `\n✘ ${failures} درخواست ناموفق از ${all.length}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
