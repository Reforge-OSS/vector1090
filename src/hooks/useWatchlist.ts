"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
const KEY = "vector1090:watchlist";
function read(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter(
                (hex): hex is string =>
                  typeof hex === "string" && /^[a-f0-9]{6}$/i.test(hex),
              )
              .map((hex) => hex.toLowerCase()),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
export function useWatchlist() {
  const [hexes, setHexes] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setHexes(read());
    setLoaded(true);
    const sync = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) setHexes(read());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(KEY, JSON.stringify(hexes));
      } catch {}
    }
  }, [hexes, loaded]);
  const toggleWatch = useCallback((hex: string) => {
    if (!/^[a-f0-9]{6}$/i.test(hex)) return;
    hex = hex.toLowerCase();
    setHexes((previous) =>
      previous.includes(hex)
        ? previous.filter((item) => item !== hex)
        : [...previous, hex],
    );
  }, []);
  return { watchlist: useMemo(() => new Set(hexes), [hexes]), toggleWatch };
}
