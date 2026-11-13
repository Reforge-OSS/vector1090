import type { Aircraft, Settings } from "./types";
type Units = Settings["units"];
const rounded = (value: number) => Math.round(value).toLocaleString("en-GB");
export function formatAltitude(
  value: Aircraft["alt_baro"],
  units: Units,
): string {
  if (value === "ground") return "Ground";
  if (value === null) return "—";
  return units === "metric"
    ? rounded(value * 0.3048) + " m"
    : rounded(value) + " ft";
}
export function formatSpeed(value: number | null, units: Units): string {
  return value === null
    ? "—"
    : units === "metric"
      ? rounded(value * 1.852) + " km/h"
      : rounded(value) + " kts";
}
export function formatDistance(value: number | null, units: Units): string {
  return value === null
    ? "—"
    : (value * (units === "metric" ? 1.852 : 1)).toFixed(1) +
        (units === "metric" ? " km" : " nm");
}
export function formatVerticalRate(value: number | null, units: Units): string {
  return value === null
    ? "—"
    : units === "metric"
      ? (value * 0.00508).toFixed(1) + " m/s"
      : rounded(value) + " fpm";
}
