"use client";
import { useEffect, useRef, useState } from "react";
import {
  parseMapState,
  serializeMapState,
  type MapCamera,
  type MapUrlState,
} from "@/lib/mapState";
import type { AircraftFilter } from "@/lib/filters";
import type { MapViewport } from "@/lib/types";
export function useMapState(viewport: MapViewport | null) {
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [filter, setFilter] = useState<AircraftFilter>("all");
  const [initialCamera, setInitialCamera] = useState<MapCamera | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = () => {
      const state = parseMapState(window.location.search);
      setSelectedHex(state.selectedHex);
      setFilter(state.filter);
      setInitialCamera(state.camera);
      setReady(true);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const latest = useRef<MapUrlState>({ selectedHex, filter, camera: null });
  const hasViewport = viewport !== null;
  latest.current = {
    selectedHex,
    filter,
    camera: viewport
      ? { ...viewport.center, zoom: viewport.zoom }
      : initialCamera,
  };
  useEffect(() => {
    if (!ready || !hasViewport) return;
    const sync = () => {
      const search = serializeMapState(latest.current, window.location.search);
      if (search !== window.location.search)
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname + search + window.location.hash,
        );
    };
    const timer = setInterval(sync, 500);
    return () => clearInterval(timer);
  }, [ready, hasViewport]);
  return {
    selectedHex,
    setSelectedHex,
    filter,
    setFilter,
    initialCamera,
    ready,
  };
}
