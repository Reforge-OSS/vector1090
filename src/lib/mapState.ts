import type { AircraftFilter } from "./filters";
export interface MapCamera {
  lat: number;
  lon: number;
  zoom: number;
}
export interface MapUrlState {
  selectedHex: string | null;
  camera: MapCamera | null;
  filter: AircraftFilter;
}
const filters: AircraftFilter[] = [
  "all",
  "low",
  "military",
  "emergency",
  "watchlist",
];
export function parseMapState(search: string): MapUrlState {
  const query = new URLSearchParams(search);
  const hex = query.get("hex");
  const lat =
    query.has("lat") && query.get("lat")?.trim()
      ? Number(query.get("lat"))
      : NaN;
  const lon =
    query.has("lon") && query.get("lon")?.trim()
      ? Number(query.get("lon"))
      : NaN;
  const zoom = query.get("zoom")?.trim() ? Number(query.get("zoom")) : 8;
  const filter = query.get("filter") as AircraftFilter;
  return {
    selectedHex: hex && /^[a-f0-9]{6}$/i.test(hex) ? hex.toLowerCase() : null,
    camera:
      Number.isFinite(lat) &&
      Math.abs(lat) <= 90 &&
      Number.isFinite(lon) &&
      Math.abs(lon) <= 180
        ? {
            lat,
            lon,
            zoom: Number.isFinite(zoom) ? Math.min(22, Math.max(0, zoom)) : 8,
          }
        : null,
    filter: filters.includes(filter) ? filter : "all",
  };
}
export function serializeMapState(state: MapUrlState, search = ""): string {
  const query = new URLSearchParams(search);
  for (const key of ["hex", "lat", "lon", "zoom", "filter"]) query.delete(key);
  if (state.selectedHex && /^[a-f0-9]{6}$/i.test(state.selectedHex))
    query.set("hex", state.selectedHex.toLowerCase());
  if (state.camera) {
    query.set("lat", state.camera.lat.toFixed(4));
    query.set("lon", state.camera.lon.toFixed(4));
    query.set("zoom", state.camera.zoom.toFixed(2));
  }
  if (state.filter !== "all" && filters.includes(state.filter))
    query.set("filter", state.filter);
  const value = query.toString();
  return value ? "?" + value : "";
}
