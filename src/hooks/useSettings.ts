"use client";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

const KEY = "vector1090:settings";
export function sanitizeSettings(input: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  merged.mode = merged.mode === "local" ? "local" : "public";
  merged.units = merged.units === "metric" ? "metric" : "aviation";
  for (const key of [
    "homeLat",
    "homeLon",
    "radiusNm",
    "pollIntervalSec",
  ] as const) {
    if (typeof merged[key] !== "number" || !Number.isFinite(merged[key]))
      merged[key] = DEFAULT_SETTINGS[key];
  }
  merged.homeLat = Math.max(-90, Math.min(90, merged.homeLat));
  merged.homeLon = Math.max(-180, Math.min(180, merged.homeLon));
  merged.radiusNm = Math.max(1, Math.min(250, merged.radiusNm));
  merged.pollIntervalSec = Math.max(
    merged.mode === "public" ? 5 : 1,
    merged.pollIntervalSec,
  );
  if (typeof merged.localUrl !== "string")
    merged.localUrl = DEFAULT_SETTINGS.localUrl;
  return merged;
}
export function useSettings() {
  const [settings, setState] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (stored && typeof stored === "object" && !Array.isArray(stored))
        setState(sanitizeSettings(stored));
    } catch {
      /* Storage can be unavailable. */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch {
        /* Storage can be full. */
      }
    }
  }, [settings, loaded]);
  const setSettings = useCallback((patch: Partial<Settings>) => {
    setState((previous) =>
      sanitizeSettings({
        ...previous,
        ...patch,
        ...(patch.mode &&
        patch.mode !== previous.mode &&
        patch.pollIntervalSec === undefined
          ? { pollIntervalSec: patch.mode === "local" ? 2 : 10 }
          : {}),
      }),
    );
  }, []);
  return { settings, setSettings, loaded };
}
