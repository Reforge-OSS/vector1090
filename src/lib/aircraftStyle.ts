import type { Aircraft } from "./types";
export const EMERGENCY_COLOR = "#ef4444";
export function altitudeColor(alt: Aircraft["alt_baro"]): string {
  if (alt === "ground" || alt === null) return "#64748b";
  if (alt < 5000) return "#10b981";
  if (alt < 10000) return "#f59e0b";
  if (alt < 25000) return "#22d3ee";
  return "#818cf8";
}
export function isEmergency(squawk: string | null): boolean {
  return squawk !== null && ["7500", "7600", "7700"].includes(squawk);
}
export function iconKind(ac: Aircraft): "jet" | "heavy" | "light" | "helicopter" | "military" {
  if (ac.isMilitary) return "military";
  if (ac.category === "A7") return "helicopter";
  if (ac.category === "A5") return "heavy";
  if (ac.category === "A1" || ac.category === "A2") return "light";
  return "jet";
}
