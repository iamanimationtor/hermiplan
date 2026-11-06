import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market/engine";
import { MARKET_INDICES, RATE_CATALOG, REGION_FACTORS, SERIES_LABELS } from "@/lib/market/rates";
import { METHODS, standardsFor } from "@/lib/standards";
import type { ProjectType } from "@/lib/engine/types";
import { checkRateLimit, clientKey } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // `refresh=1` would otherwise let anyone bypass the cache and hammer the
  // upstream feed, so it is rate limited like any other expensive call.
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  if (force) {
    const limited = await checkRateLimit(clientKey(request, "market"), { limit: 10, windowMs: 60_000 });
    if (!limited.allowed) {
      return NextResponse.json(
        { error: "تعداد درخواست‌های به‌روزرسانی نرخ بیش از حد مجاز است" },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds), "Cache-Control": "no-store" } },
      );
    }
  }
  const snapshot = await getMarketSnapshot(force);
  const type = new URL(request.url).searchParams.get("type") as ProjectType | null;

  return NextResponse.json({
    ...snapshot,
    catalogSize: RATE_CATALOG.length,
    seriesOptions: Object.entries(SERIES_LABELS).map(([id, label]) => ({ id, label })),
    regions: Object.entries(REGION_FACTORS).map(([id, value]) => ({ id, label: value.label, factor: value.factor })),
    indices: MARKET_INDICES,
    standards: type ? standardsFor(type) : null,
    methods: METHODS,
    feedConfigured: Boolean(process.env.HERMIPLAN_MARKET_FEED),
  });
}
