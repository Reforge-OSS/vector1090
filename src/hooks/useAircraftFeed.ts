"use client";
import { useEffect, useRef, useState } from "react";
import type { Aircraft, AircraftResponse, Settings } from "@/lib/types";

export interface TrailPoint {
  lon: number;
  lat: number;
  alt: Aircraft["alt_baro"];
}
export type Trails = Map<string, TrailPoint[]>;
export type FeedStatus =
  "connecting" | "online" | "paused" | "rate-limited" | "error";
export function useAircraftFeed(
  settings: Settings,
  userPaused: boolean,
  allowClientLocalUrl = false,
) {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const trailsRef = useRef<Trails>(new Map());
  const lastSeenRef = useRef(new Map<string, number>());
  const retryNotBefore = useRef(0);
  const { mode, homeLat, homeLon, radiusNm, localUrl, pollIntervalSec } =
    settings;
  const source = JSON.stringify(
    mode === "public"
      ? [mode, homeLat, homeLon, radiusNm]
      : [mode, localUrl, allowClientLocalUrl],
  );
  const sourceRef = useRef(source);
  useEffect(() => {
    if (sourceRef.current !== source) {
      sourceRef.current = source;
      setAircraft([]);
      setTotal(0);
      setLastUpdate(null);
      trailsRef.current.clear();
      lastSeenRef.current.clear();
      retryNotBefore.current = 0;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failures = 0;
    let generation = 0;
    const paused = () => userPaused || document.hidden;
    const schedule = (ms: number) => {
      timer = setTimeout(poll, ms);
    };
    async function poll() {
      if (disposed || paused()) return;
      const run = generation;
      const stale = () => disposed || paused() || run !== generation;
      if (Date.now() < retryNotBefore.current) {
        setStatus("rate-limited");
        schedule(retryNotBefore.current - Date.now());
        return;
      }
      controller = new AbortController();
      let delay = Math.max(mode === "public" ? 5 : 1, pollIntervalSec) * 1000;
      try {
        const query = new URLSearchParams({
          mode,
          lat: String(homeLat),
          lon: String(homeLon),
          radius: String(radiusNm),
        });
        if (mode === "local" && allowClientLocalUrl) query.set("url", localUrl);
        const response = await fetch("/api/aircraft?" + query, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (stale()) return;
        if (response.status === 429) {
          const body = await response.json();
          if (stale()) return;
          const seconds = Number(body.retryAfter);
          const date = Date.parse(body.retryAfter);
          delay = Math.max(
            30_000,
            Number.isFinite(seconds)
              ? seconds * 1000
              : Number.isFinite(date)
                ? date - Date.now()
                : 30_000,
          );
          retryNotBefore.current = Date.now() + delay;
          setStatus("rate-limited");
        } else {
          if (!response.ok) throw new Error("feed_failed");
          const body: AircraftResponse = await response.json();
          if (stale()) return;
          if (!Array.isArray(body.aircraft)) throw new Error("invalid_feed");
          const received = Date.now();
          for (const ac of body.aircraft) {
            const observedAt = received - Math.max(0, ac.seen ?? 0) * 1000;
            lastSeenRef.current.set(ac.hex, observedAt);
            if (ac.lat === null || ac.lon === null) continue;
            const trail = trailsRef.current.get(ac.hex) ?? [];
            const last = trail[trail.length - 1];
            if (!last || last.lat !== ac.lat || last.lon !== ac.lon) {
              trail.push({ lat: ac.lat, lon: ac.lon, alt: ac.alt_baro });
              if (trail.length > 300) trail.splice(0, trail.length - 300);
            }
            trailsRef.current.set(ac.hex, trail);
          }
          for (const [hex, seen] of lastSeenRef.current) {
            if (received - seen > 300_000) {
              trailsRef.current.delete(hex);
              lastSeenRef.current.delete(hex);
            }
          }
          setAircraft(body.aircraft);
          setTotal(body.total);
          setLastUpdate(received);
          setStatus("online");
          failures = 0;
        }
      } catch (error) {
        if (stale() || (error instanceof Error && error.name === "AbortError"))
          return;
        setStatus("error");
        delay = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5));
      } finally {
        if (run === generation) controller = null;
      }
      if (!stale()) schedule(delay);
    }
    function restart() {
      generation++;
      clearTimeout(timer);
      controller?.abort();
      if (paused()) setStatus("paused");
      else {
        setStatus("connecting");
        void poll();
      }
    }
    restart();
    document.addEventListener("visibilitychange", restart);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", restart);
    };
  }, [
    mode,
    homeLat,
    homeLon,
    radiusNm,
    localUrl,
    pollIntervalSec,
    userPaused,
    allowClientLocalUrl,
    source,
  ]);
  return { aircraft, status, lastUpdate, total, trailsRef };
}
