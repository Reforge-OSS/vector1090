import { distanceNm } from "./geo";
import type { Aircraft, Coordinates, MapBounds, PublicQuery } from "./types";

export function mergeFeeds(
  local: Aircraft[],
  publicFeed: Aircraft[],
): Aircraft[] {
  const merged = new Map<string, Aircraft>();
  for (const aircraft of publicFeed) {
    const hex = aircraft.hex.trim().toLowerCase();
    merged.set(hex, { ...aircraft, hex, feedSource: "public" });
  }
  for (const aircraft of local) {
    const hex = aircraft.hex.trim().toLowerCase();
    merged.set(hex, { ...aircraft, hex, feedSource: "local" });
  }
  return [...merged.values()];
}

export function clampViewportRadius(radius: number): number {
  return Number.isFinite(radius)
    ? Math.max(1, Math.min(250, Math.ceil(radius)))
    : 250;
}

export function viewportRadius(center: Coordinates, bounds: MapBounds): number {
  return Math.max(
    ...[bounds.west, bounds.east].flatMap((lon) =>
      [bounds.south, bounds.north].map((lat) =>
        distanceNm(center.lat, center.lon, lat, lon),
      ),
    ),
  );
}

export function viewportQuery(
  center: Coordinates,
  bounds: MapBounds,
  zoom: number,
): PublicQuery {
  return zoom < 5
    ? { scope: "global" }
    : {
        scope: "area",
        ...center,
        radius: clampViewportRadius(viewportRadius(center, bounds)),
      };
}

export function normalizePublicQuery(query: PublicQuery): PublicQuery {
  if (query.scope === "global") return { scope: "global" };
  const lat = Math.round(query.lat * 4) / 4;
  const lon = Math.round(query.lon * 4) / 4;
  const radius = clampViewportRadius(
    clampViewportRadius(query.radius) +
      distanceNm(query.lat, query.lon, lat, lon),
  );
  return {
    scope: "area",
    lat,
    lon,
    radius: [25, 50, 100, 150, 250].find((bucket) => bucket >= radius)!,
  };
}
