export interface Aircraft {
  hex: string;
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
  seen: number | null;
}
export type FeedMode = "public" | "local";
export interface Settings {
  mode: FeedMode;
  localUrl: string;
  homeLat: number;
  homeLon: number;
  radiusNm: number;
  units: "aviation" | "metric";
  pollIntervalSec: number;
}
export const DEFAULT_SETTINGS: Settings = {
  mode: "public", localUrl: "http://localhost:8080/data/aircraft.json",
  homeLat: 52.8311, homeLon: -1.3281, radiusNm: 50, units: "aviation", pollIntervalSec: 10,
};
export interface AircraftResponse {
  aircraft: Aircraft[];
  now: number;
  mode: FeedMode;
  total: number;
}
