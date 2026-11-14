"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Aircraft, Coordinates } from "@/lib/types";
import { sanitizeSectors, updateReceiverSectors } from "@/lib/mapGeometry";
export function useReceiverRange(
  home: Coordinates,
  aircraft: Aircraft[],
  enabled: boolean,
) {
  const { lat, lon } = home;
  const key =
    "vector1090:receiver-range:" +
    home.lat.toFixed(4) +
    "," +
    home.lon.toFixed(4);
  const [state, setState] = useState({
    key: "",
    sectors: sanitizeSectors(null),
  });
  const lastSample = useRef<{ key: string; aircraft: Aircraft[] } | null>(null);
  useEffect(() => {
    let sectors = sanitizeSectors(null);
    try {
      sectors = sanitizeSectors(
        JSON.parse(localStorage.getItem(key) ?? "null"),
      );
    } catch {
      sectors = sanitizeSectors(null);
    }
    setState({ key, sectors });
  }, [key]);
  useEffect(() => {
    if (!enabled || state.key !== key) return;
    const previous = lastSample.current;
    if (
      previous?.key === key &&
      previous.aircraft.length === aircraft.length &&
      aircraft.every((ac, index) => ac === previous.aircraft[index])
    )
      return;
    lastSample.current = { key, aircraft };
    setState((previous) => {
      const sectors = updateReceiverSectors(
        previous.sectors,
        { lat, lon },
        aircraft,
      );
      return sectors.some((value, index) => value !== previous.sectors[index])
        ? { key, sectors }
        : previous;
    });
  }, [aircraft, lat, lon, enabled, key, state.key]);
  useEffect(() => {
    if (state.key === key) {
      try {
        localStorage.setItem(key, JSON.stringify(state.sectors));
      } catch {
        return;
      }
    }
  }, [key, state]);
  const reset = useCallback(
    () => setState({ key, sectors: sanitizeSectors(null) }),
    [key],
  );
  return {
    sectors: state.key === key ? state.sectors : sanitizeSectors(null),
    reset,
  };
}
