"use client";
import { useEffect, useRef, useState } from "react";
import { normalizePublicQuery, viewportQuery } from "@/lib/feeds";
import type {
  Aircraft,
  AircraftResponse,
  FeedSources,
  MapViewport,
  PublicQuery,
  Settings,
} from "@/lib/types";

interface TrailPoint {
  lon: number;
  lat: number;
  alt: Aircraft["alt_baro"];
}
export type Trails = Map<string, TrailPoint[]>;
export interface HistoryPoint {
  time: number;
  alt: Aircraft["alt_baro"];
  gs: number | null;
}
export type FeedStatus =
  "connecting" | "online" | "partial" | "paused" | "rate-limited" | "error";

export function useAircraftFeed(
  settings: Settings,
  userPaused: boolean,
  allowClientLocalUrl = false,
  viewport?: MapViewport | null,
) {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState<FeedSources | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const trailsRef = useRef<Trails>(new Map());
  const historyRef = useRef(new Map<string, HistoryPoint[]>());
  const lastSeenRef = useRef(new Map<string, number>());
  const retryNotBefore = useRef(0);
  const {
    mode,
    homeLat,
    homeLon,
    radiusNm,
    localUrl,
    pollIntervalSec,
    trackViewport,
  } = settings;
  const source = JSON.stringify(
    mode === "public" ? [mode] : [mode, localUrl, allowClientLocalUrl],
  );
  const sourceRef = useRef(source);
  const waitingForViewport =
    mode !== "local" && trackViewport && viewport === null;
  const publicQuery: PublicQuery =
    trackViewport && viewport && mode !== "local"
      ? viewportQuery(viewport.center, viewport.bounds, viewport.zoom)
      : { scope: "area", lat: homeLat, lon: homeLon, radius: radiusNm };
  const query = new URLSearchParams({ mode });
  if (mode === "local") {
    if (allowClientLocalUrl) query.set("url", localUrl);
  } else {
    const normalized = normalizePublicQuery(publicQuery);
    query.set("scope", normalized.scope);
    if (normalized.scope === "area") {
      query.set("lat", String(normalized.lat));
      query.set("lon", String(normalized.lon));
      query.set("radius", String(normalized.radius));
    }
  }
  const requestQuery = query.toString();

  useEffect(() => {
    if (sourceRef.current !== source) {
      sourceRef.current = source;
      setAircraft([]);
      setTotal(0);
      setLastUpdate(null);
      setSources(null);
      setRetryAfter(null);
      setStale(false);
      trailsRef.current.clear();
      historyRef.current.clear();
      lastSeenRef.current.clear();
      retryNotBefore.current = 0;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let failures = 0;
    let generation = 0;
    const paused = () => userPaused || document.hidden || waitingForViewport;
    const schedule = (ms: number) => {
      timer = setTimeout(poll, ms);
    };

    function applyFeed(body: AircraftResponse) {
      if (!Array.isArray(body.aircraft)) throw new Error("invalid_feed");
      const received = Number.isFinite(body.now)
        ? Math.min(Date.now(), body.now * 1000)
        : Date.now();
      for (const ac of body.aircraft) {
        const observedAt = received - Math.max(0, ac.seen ?? 0) * 1000;
        lastSeenRef.current.set(ac.hex, observedAt);
        const history = historyRef.current.get(ac.hex) ?? [];
        if (!history.length || observedAt > history[history.length - 1].time) {
          history.push({ time: observedAt, alt: ac.alt_baro, gs: ac.gs });
          if (history.length > 600) history.splice(0, history.length - 600);
          historyRef.current.set(ac.hex, history);
        }
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
        if (Date.now() - seen > 300_000) {
          trailsRef.current.delete(hex);
          historyRef.current.delete(hex);
          lastSeenRef.current.delete(hex);
        }
      }
      setAircraft(body.aircraft);
      setTotal(body.total);
      setLastUpdate(received);
    }

    async function poll() {
      if (disposed || paused()) return;
      const run = generation;
      const outdated = () => disposed || paused() || run !== generation;
      if (Date.now() < retryNotBefore.current) {
        setStatus("rate-limited");
        schedule(retryNotBefore.current - Date.now());
        return;
      }
      controller = new AbortController();
      let delay = Math.max(mode === "local" ? 1 : 5, pollIntervalSec) * 1000;
      try {
        const response = await fetch("/api/aircraft?" + requestQuery, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (outdated()) return;
        if (!response.ok && response.status !== 429)
          throw new Error("feed_failed");
        const body = await response.json();
        if (outdated()) return;
        setSources(body.sources ?? null);
        setRetryAfter(body.retryAfter ?? null);
        setStale(body.stale === true);
        if (response.status === 429) {
          const seconds = Number(body.retryAfter);
          const date = Date.parse(body.retryAfter);
          const retryDelay = Math.max(
            30_000,
            Number.isFinite(seconds)
              ? seconds * 1000
              : Number.isFinite(date)
                ? date - Date.now()
                : 30_000,
          );
          if (mode !== "hybrid") {
            delay = retryDelay;
            retryNotBefore.current = Date.now() + delay;
          }
          if (body.stale || body.aircraft?.length) applyFeed(body);
          setStatus("rate-limited");
        } else {
          applyFeed(body);
          const degraded =
            body.sources &&
            (Object.values(body.sources).some(
              (value) => value === "error" || value === "rate_limited",
            ) ||
              (mode === "hybrid" && body.sources.local === "disabled"));
          setStatus(degraded ? "partial" : "online");
          failures = 0;
        }
      } catch (error) {
        if (
          outdated() ||
          (error instanceof Error && error.name === "AbortError")
        )
          return;
        setStatus("error");
        delay = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5));
      } finally {
        if (run === generation) controller = null;
      }
      if (!outdated()) schedule(delay);
    }
    function restart() {
      generation++;
      clearTimeout(timer);
      controller?.abort();
      if (paused())
        setStatus(
          waitingForViewport && !userPaused && !document.hidden
            ? "connecting"
            : "paused",
        );
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
    requestQuery,
    source,
    pollIntervalSec,
    userPaused,
    waitingForViewport,
  ]);
  return {
    aircraft,
    status,
    lastUpdate,
    total,
    trailsRef,
    historyRef,
    sources,
    retryAfter,
    stale,
  };
}
