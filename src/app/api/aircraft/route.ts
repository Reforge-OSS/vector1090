import { NextRequest, NextResponse } from "next/server";
import { normalizeFeed } from "@/lib/normalize";
import {
  DEFAULT_SETTINGS,
  type AircraftResponse,
  type FeedMode,
} from "@/lib/types";

export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function numeric(value: string | null | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const mode = query.get("mode") ?? process.env.FEED_MODE ?? "public";
  if (mode !== "public" && mode !== "local")
    return response({ error: "invalid_mode" }, 400);
  const lat = numeric(
    query.get("lat"),
    numeric(process.env.HOME_LAT, DEFAULT_SETTINGS.homeLat),
  );
  const lon = numeric(
    query.get("lon"),
    numeric(process.env.HOME_LON, DEFAULT_SETTINGS.homeLon),
  );
  const radius = Math.min(
    250,
    Math.max(
      1,
      numeric(query.get("radius"), numeric(process.env.HOME_RADIUS_NM, 50)),
    ),
  );
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180)
    return response({ error: "invalid_coordinates" }, 400);
  let url: URL;
  try {
    if (mode === "local") {
      const local =
        process.env.ALLOW_CLIENT_LOCAL_URL === "true"
          ? (query.get("url") ?? process.env.LOCAL_AIRCRAFT_URL)
          : process.env.LOCAL_AIRCRAFT_URL;
      url = new URL(local ?? DEFAULT_SETTINGS.localUrl);
    } else {
      url = new URL(
        `${(process.env.ADSB_API_BASE ?? "https://api.adsb.lol").replace(/\/$/, "")}/v2/point/${lat}/${lon}/${radius}`,
      );
    }
    if (!["http:", "https:"].includes(url.protocol))
      return response({ error: "invalid_url" }, 400);
  } catch {
    return response({ error: "invalid_url" }, 400);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "vector1090/1.0 (+https://github.com/Reforge-OSS/vector1090)",
    };
    if (mode === "public" && process.env.ADSB_API_KEY)
      headers["x-api-key"] = process.env.ADSB_API_KEY;
    const upstream = await fetch(url, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (upstream.status === 429) {
      return response(
        {
          error: "rate_limited",
          retryAfter: upstream.headers.get("Retry-After") ?? 30,
        },
        429,
      );
    }
    if (!upstream.ok)
      return response({ error: `upstream_${upstream.status}` }, 502);
    const json: unknown = await upstream.json();
    const aircraft = normalizeFeed(json);
    const now =
      json &&
      typeof json === "object" &&
      "now" in json &&
      typeof json.now === "number"
        ? json.now
        : Date.now() / 1000;
    return response({
      aircraft,
      now,
      mode: mode as FeedMode,
      total: aircraft.length,
    } satisfies AircraftResponse);
  } catch (error) {
    return response(
      {
        error:
          error instanceof Error && error.name === "AbortError"
            ? "upstream_timeout"
            : "upstream_fetch_failed",
      },
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}
