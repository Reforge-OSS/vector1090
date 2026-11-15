import { NextRequest, NextResponse } from "next/server";
import {
  configuredReceiverUrl,
  FeedProxy,
  type SourceResult,
} from "@/lib/feedProxy";
import { clampViewportRadius, mergeFeeds } from "@/lib/feeds";
import {
  DEFAULT_SETTINGS,
  type AircraftResponse,
  type FeedMode,
  type PublicQuery,
} from "@/lib/types";

export const dynamic = "force-dynamic";
const proxy = new FeedProxy();
const response = (body: unknown, status = 200, cache = "miss") =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Cache": cache },
  });

function numeric(value: string | null | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function failed(error = "upstream_fetch_failed"): SourceResult {
  return {
    aircraft: [],
    now: Date.now() / 1000,
    status: "error",
    available: false,
    cache: "miss",
    error,
  };
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const mode = (query.get("mode") ?? process.env.FEED_MODE ?? "public")
    .trim()
    .toLowerCase();
  if (mode !== "public" && mode !== "local" && mode !== "hybrid")
    return response({ error: "invalid_mode" }, 400);
  const scope = query.get("scope") ?? "area";
  if (mode !== "local" && scope !== "area" && scope !== "global")
    return response({ error: "invalid_scope" }, 400);
  const lat = numeric(
    query.get("lat"),
    numeric(process.env.HOME_LAT, DEFAULT_SETTINGS.homeLat),
  );
  const lon = numeric(
    query.get("lon"),
    numeric(process.env.HOME_LON, DEFAULT_SETTINGS.homeLon),
  );
  const radius = clampViewportRadius(
    numeric(
      query.get("radius"),
      numeric(process.env.HOME_RADIUS_NM, DEFAULT_SETTINGS.radiusNm),
    ),
  );
  if (
    mode !== "local" &&
    scope === "area" &&
    (lat < -90 || lat > 90 || lon < -180 || lon > 180)
  )
    return response({ error: "invalid_coordinates" }, 400);
  const publicQuery: PublicQuery =
    scope === "global"
      ? { scope: "global" }
      : { scope: "area", lat, lon, radius };
  const configured = configuredReceiverUrl();
  const receiver =
    mode === "hybrid"
      ? configured
      : mode === "local"
        ? ((process.env.ALLOW_CLIENT_LOCAL_URL === "true"
            ? (query.get("url") ?? configured)
            : configured) ?? DEFAULT_SETTINGS.localUrl)
        : undefined;
  let localRequest: Promise<SourceResult | undefined> =
    Promise.resolve(undefined);
  if (receiver !== undefined) {
    try {
      const url = new URL(receiver);
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("invalid_url");
      localRequest = proxy.localFeed(url.href);
    } catch {
      if (mode === "local") return response({ error: "invalid_url" }, 400);
      localRequest = Promise.resolve(failed("invalid_url"));
    }
  }
  const results = await Promise.allSettled([
    localRequest,
    mode === "local"
      ? Promise.resolve(undefined)
      : proxy.publicFeed(publicQuery),
  ]);
  const [local, publicFeed] = results.map((result) =>
    result.status === "fulfilled" ? result.value : failed(),
  );
  const active = [local, publicFeed].filter(
    (result): result is SourceResult => !!result,
  );
  const available = active.filter((result) => result.available);
  const limited = active.some((result) => result.status === "rate_limited");
  const status =
    limited && (mode === "public" || !available.length)
      ? 429
      : available.length
        ? 200
        : 502;
  const now = available.length
    ? Math.max(...available.map((result) => result.now))
    : Date.now() / 1000;
  const atResponseTime = (result: SourceResult | undefined) =>
    result?.aircraft.map((aircraft) => ({
      ...aircraft,
      stale: aircraft.stale ?? result.stale ?? false,
      seen:
        aircraft.seen === null
          ? null
          : aircraft.seen + Math.max(0, now - result.now),
    })) ?? [];
  const aircraft = mergeFeeds(
    atResponseTime(local),
    atResponseTime(publicFeed),
  );
  const body: AircraftResponse & { error?: string } = {
    aircraft,
    now,
    mode: mode as FeedMode,
    total: aircraft.length,
    sources: {
      local: local?.status ?? "disabled",
      public: publicFeed?.status ?? "disabled",
    },
    ...(limited
      ? {
          retryAfter: Math.max(
            ...active.map((result) => result.retryAfter ?? 0),
          ),
        }
      : {}),
    ...(active.some((result) => result.stale) ? { stale: true } : {}),
    ...(status >= 400
      ? {
          error: limited
            ? "rate_limited"
            : (active.find((result) => result.error)?.error ??
              "upstream_fetch_failed"),
        }
      : {}),
  };
  const cache = active.every((result) => result.cache === "hit")
    ? "hit"
    : active.some((result) => result.cache === "cooldown")
      ? "cooldown"
      : active.some((result) => result.cache === "coalesced")
        ? "coalesced"
        : "miss";
  return response(body, status, cache);
}
