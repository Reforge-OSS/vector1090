"use client";
import { useEffect, useRef, useState } from "react";
import type { Aircraft } from "@/lib/types";
interface Selection {
  aircraft: Aircraft;
  lastUpdate: number | null;
  source: string;
}
export function useSelectedAircraft(
  hex: string | null,
  aircraft: Aircraft | undefined,
  lastUpdate: number | null,
  source: string,
) {
  const [cached, setCached] = useState<Selection | null>(null);
  const previousSource = useRef(source);
  useEffect(() => {
    if (aircraft) setCached({ aircraft, lastUpdate, source });
  }, [aircraft, lastUpdate, source]);
  useEffect(() => {
    if (previousSource.current !== source) {
      previousSource.current = source;
      setCached(null);
    }
  }, [source]);
  return aircraft
    ? { aircraft, lastUpdate }
    : cached?.source === source && cached.aircraft.hex === hex
      ? cached
      : null;
}
