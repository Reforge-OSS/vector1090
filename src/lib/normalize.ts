import type { Aircraft } from "./types";

const numberOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const stringOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
export function normalizeAircraft(
  raw: unknown,
  feedSource: Aircraft["feedSource"] = "public",
): Aircraft | null {
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
    feedSource,
    rssi: numberOrNull(ac.rssi),
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
    isPIA: (flags & 4) !== 0,
    isLADD: (flags & 8) !== 0,
    ias: numberOrNull(ac.ias),
    tas: numberOrNull(ac.tas),
    mach: numberOrNull(ac.mach),
    alt_geom: numberOrNull(ac.alt_geom),
    nav_altitude_mcp: numberOrNull(ac.nav_altitude_mcp),
    nav_qnh: numberOrNull(ac.nav_qnh),
    nav_modes: Array.isArray(ac.nav_modes)
      ? ac.nav_modes.filter((mode): mode is string => typeof mode === "string")
      : null,
    wind_dir: numberOrNull(ac.wd),
    wind_speed: numberOrNull(ac.ws),
    roll: numberOrNull(ac.roll),
    mag_heading: numberOrNull(ac.mag_heading),
    true_heading: numberOrNull(ac.true_heading),
    positionSource: stringOrNull(ac.type),
    messages: numberOrNull(ac.messages),
  };
}
export function normalizeFeed(
  json: unknown,
  feedSource: Aircraft["feedSource"] = "public",
): Aircraft[] {
  if (!json || typeof json !== "object") return [];
  const feed = json as Record<string, unknown>;
  const entries = Array.isArray(feed.ac) ? feed.ac : feed.aircraft;
  return Array.isArray(entries)
    ? entries
        .map((entry) => normalizeAircraft(entry, feedSource))
        .filter((ac): ac is Aircraft => ac !== null)
    : [];
}
