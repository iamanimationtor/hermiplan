import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market/engine";
import { MARKET_INDICES, RATE_CATALOG, REGION_FACTORS, SERIES_LABELS } from "@/lib/market/rates";
import { METHODS, standardsFor } from "@/lib/standards";
import type { ProjectType } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
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
