import type { Aircraft } from "./types";

const numberOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const stringOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
export function normalizeAircraft(raw: unknown): Aircraft | null {
  if (!raw || typeof raw !== "object") return null;
  const ac = raw as Record<string, unknown>;
  const hex = stringOrNull(ac.hex)?.toLowerCase();
  if (!hex) return null;
  const last =
    ac.lastPosition && typeof ac.lastPosition === "object"
      ? (ac.lastPosition as Record<string, unknown>)
      : {};
  const flags = numberOrNull(ac.dbFlags) ?? 0;
  return {
    hex,
    flight: stringOrNull(ac.flight),
    reg: stringOrNull(ac.r),
    type: stringOrNull(ac.t),
    alt_baro: ac.alt_baro === "ground" ? "ground" : numberOrNull(ac.alt_baro),
    gs: numberOrNull(ac.gs),
    track:
      numberOrNull(ac.track) ??
      numberOrNull(ac.true_heading) ??
      numberOrNull(ac.mag_heading),
    baro_rate: numberOrNull(ac.baro_rate) ?? numberOrNull(ac.geom_rate),
    squawk: stringOrNull(ac.squawk),
    lat: numberOrNull(ac.lat) ?? numberOrNull(last.lat),
    lon: numberOrNull(ac.lon) ?? numberOrNull(last.lon),
    category: stringOrNull(ac.category),
    seen: numberOrNull(ac.seen),
    isMilitary: (flags & 1) !== 0,
    isInteresting: (flags & 2) !== 0,
  };
}
export function normalizeFeed(json: unknown): Aircraft[] {
  if (!json || typeof json !== "object") return [];
  const feed = json as Record<string, unknown>;
  const entries = Array.isArray(feed.ac) ? feed.ac : feed.aircraft;
  return Array.isArray(entries)
    ? entries.map(normalizeAircraft).filter((ac): ac is Aircraft => ac !== null)
    : [];
}
