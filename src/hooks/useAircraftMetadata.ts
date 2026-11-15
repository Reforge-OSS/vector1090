"use client";
import { useEffect, useState } from "react";
import type { Airframe, FlightRoute } from "@/lib/intelligence";

const cache = new Map<string, { promise: Promise<unknown>; expires: number }>();
function lookup(url: string, field: string): Promise<unknown> {
  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const entry = { expires: Infinity, promise: Promise.resolve<unknown>(null) };
  entry.promise = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("metadata_failed");
      const json = await response.json();
      if (!Object.prototype.hasOwnProperty.call(json, field))
        throw new Error("invalid_metadata");
      entry.expires = Date.now() + (json[field] ? 86400_000 : 3600_000);
      return json[field];
    })
    .catch((error) => {
      if (cache.get(url) === entry) cache.delete(url);
      throw error;
    });
  if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
  cache.set(url, entry);
  return entry.promise;
}
function useMetadata<T>(url: string | null, field: string) {
  const [state, setState] = useState<{
    url: string | null;
    data: T | null;
    loading: boolean;
    error: boolean;
  }>({ url: null, data: null, loading: false, error: false });
  useEffect(() => {
    let active = true;
    setState({ url, data: null, loading: !!url, error: false });
    if (url)
      void lookup(url, field)
        .then((data) => {
          if (active)
            setState({
              url,
              data: data as T | null,
              loading: false,
              error: false,
            });
        })
        .catch(() => {
          if (active)
            setState({ url, data: null, loading: false, error: true });
        });
    return () => {
      active = false;
    };
  }, [url, field]);
  return state.url === url
    ? state
    : { data: null, loading: !!url, error: false };
}
export function useCallsignRoute(callsign: string | null | undefined) {
  const normalized = callsign?.trim().toUpperCase();
  return useMetadata<FlightRoute>(
    normalized && /^[A-Z0-9]{2,10}$/.test(normalized)
      ? "/api/callsign/" + normalized
      : null,
    "route",
  );
}
export function useAirframe(hex: string) {
  return useMetadata<Airframe>(
    /^[a-f0-9]{6}$/i.test(hex) ? "/api/airframe/" + hex.toLowerCase() : null,
    "airframe",
  );
}
