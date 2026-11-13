import type { Aircraft, Settings } from "./types";
import { distanceNm } from "./geo";
import { isEmergency } from "./aircraftStyle";
export type AircraftFilter = "all" | "low" | "military" | "emergency";
export function aircraftDistance(ac: Aircraft, home: Pick<Settings, "homeLat" | "homeLon">): number | null {
  return ac.lat === null || ac.lon === null ? null : distanceNm(home.homeLat, home.homeLon, ac.lat, ac.lon);
}
export function filterAircraft(aircraft: Aircraft[], search: string, filter: AircraftFilter, home: Pick<Settings, "homeLat" | "homeLon">): Aircraft[] {
  const term = search.trim().toLowerCase();
  return aircraft.filter(ac => (!term || [ac.flight, ac.hex, ac.reg, ac.type].some(v => v?.toLowerCase().includes(term))) &&
    (filter === "all" || filter === "low" && (ac.alt_baro === "ground" || typeof ac.alt_baro === "number" && ac.alt_baro < 15000) ||
    filter === "military" && ac.isMilitary || filter === "emergency" && isEmergency(ac.squawk)))
    .sort((a, b) => (aircraftDistance(a, home) ?? Infinity) - (aircraftDistance(b, home) ?? Infinity) || a.hex.localeCompare(b.hex));
}
