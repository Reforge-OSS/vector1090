import type { Aircraft } from "./types";
import palette from "./palette.json";
export const EMERGENCY_COLOR = palette.rose;
export function altitudeColor(alt: Aircraft["alt_baro"]): string {
  if (alt === "ground" || alt === null) return palette.ground;
  if (alt < 5000) return palette.sage;
  if (alt < 10000) return palette.sand;
  if (alt < 25000) return palette.powder;
  return palette.lavender;
}
export function isEmergency(squawk: string | null): boolean {
  return squawk !== null && ["7500", "7600", "7700"].includes(squawk);
}
export function iconKind(
  ac: Aircraft,
): "jet" | "heavy" | "light" | "helicopter" | "military" {
  if (ac.isMilitary) return "military";
  if (ac.category === "A7") return "helicopter";
  if (ac.category === "A5") return "heavy";
  if (ac.category === "A1" || ac.category === "A2") return "light";
  return "jet";
}
