const EARTH_RADIUS_NM = 3440.065;
const rad = (deg: number) => deg * Math.PI / 180;
const deg = (radians: number) => radians * 180 / Math.PI;
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}
export function destinationPoint(lat: number, lon: number, bearingDeg: number, distNm: number): [number, number] {
  const d = distNm / EARTH_RADIUS_NM, b = rad(bearingDeg), p = rad(lat);
  const p2 = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
  const l2 = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(p2));
  return [((deg(l2) + 540) % 360) - 180, deg(p2)];
}
export function circlePolygon(lat: number, lon: number, radiusNm: number, steps = 128): [number, number][] {
  const count = Math.max(3, Number.isFinite(steps) ? Math.floor(steps) : 128);
  const ring = Array.from({ length: count }, (_, i) => destinationPoint(lat, lon, i * 360 / count, radiusNm));
  ring.push([...ring[0]]);
  return ring;
}
export function deadReckon(lat: number, lon: number, gsKts: number, trackDeg: number, elapsedSec: number): [number, number] {
  return destinationPoint(lat, lon, trackDeg, gsKts * elapsedSec / 3600);
}
