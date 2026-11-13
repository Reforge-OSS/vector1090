export interface Aircraft {
  hex: string;
  feedSource: "local" | "public";
  rssi: number | null;
  flight: string | null;
  reg: string | null;
  type: string | null;
  alt_baro: number | "ground" | null;
  gs: number | null;
  track: number | null;
  baro_rate: number | null;
  squawk: string | null;
  lat: number | null;
  lon: number | null;
  category: string | null;
  isMilitary: boolean;
  isInteresting: boolean;
  isPIA: boolean;
  isLADD: boolean;
  seen: number | null;
  ias: number | null;
  tas: number | null;
  mach: number | null;
  alt_geom: number | null;
  nav_altitude_mcp: number | null;
  nav_qnh: number | null;
  nav_modes: string[] | null;
  wind_dir: number | null;
  wind_speed: number | null;
  roll: number | null;
  mag_heading: number | null;
  true_heading: number | null;
  positionSource: string | null;
  messages: number | null;
}
export type FeedMode = "public" | "local" | "hybrid";
export type SourceStatus = "ok" | "error" | "rate_limited" | "disabled";
export interface FeedSources {
  local: SourceStatus;
  public: SourceStatus;
}
export interface Coordinates {
  lat: number;
  lon: number;
}
export interface MapBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}
export interface MapViewport {
  center: Coordinates;
  bounds: MapBounds;
  zoom: number;
  radiusNm: number;
}
export type PublicQuery =
  | { scope: "global" }
  | { scope: "area"; lat: number; lon: number; radius: number };
export interface Settings {
  mode: FeedMode;
  localUrl: string;
  homeLat: number;
  homeLon: number;
  radiusNm: number;
  units: "aviation" | "metric";
  pollIntervalSec: number;
  trackViewport: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  mode: "public",
  localUrl: "http://localhost:8080/data/aircraft.json",
  homeLat: 52.8311,
  homeLon: -1.3281,
  radiusNm: 50,
  units: "aviation",
  pollIntervalSec: 10,
  trackViewport: true,
};
export interface AircraftResponse {
  aircraft: Aircraft[];
  now: number;
  mode: FeedMode;
  total: number;
  sources: FeedSources;
  retryAfter?: number;
  stale?: boolean;
}
