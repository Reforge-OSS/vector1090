"use client";
import { useEffect, useState } from "react";
import { rainviewerTiles } from "@/lib/weather";
let cached: { tiles: string; expires: number } | null = null;
let pending: Promise<string> | null = null;
function load(): Promise<string> {
  if (cached && cached.expires > Date.now())
    return Promise.resolve(cached.tiles);
  if (pending) return pending;
  pending = fetch("https://api.rainviewer.com/public/weather-maps.json")
    .then(async (response) => {
      if (!response.ok) throw new Error("weather_unavailable");
      const tiles = rainviewerTiles(await response.json());
      if (!tiles) throw new Error("invalid_weather");
      cached = { tiles, expires: Date.now() + 600_000 };
      return tiles;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
export function useWeatherRadar(enabled: boolean) {
  const [tiles, setTiles] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = () => {
      void load()
        .then((value) => {
          if (active) {
            setTiles(value);
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    };
    refresh();
    const timer = setInterval(refresh, 600_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return { tiles, error };
}
