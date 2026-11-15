import type {
  FeatureCollection,
  LineString,
  MultiLineString,
  Point,
  Polygon,
} from "geojson";
import { deadReckon, destinationPoint, distanceNm } from "./geo";
import type { Coordinates, Aircraft } from "./types";
import type { FlightRoute } from "./intelligence";
import { altitudeColor } from "./aircraftStyle";

type Position = [number, number];
export function aircraftPosition(
  ac: Aircraft,
  lastUpdate: number | null,
  now: number,
): Position | null {
  if (
    ac.lat === null ||
    ac.lon === null ||
    !Number.isFinite(ac.lat) ||
    !Number.isFinite(ac.lon) ||
    Math.abs(ac.lat) > 90 ||
    Math.abs(ac.lon) > 180
  )
    return null;
  const elapsed = Math.min(
    60,
    Math.max(0, (now - (lastUpdate ?? now)) / 1000 + (ac.seen ?? 0)),
  );
  return ac.alt_baro !== "ground" && ac.gs !== null && ac.track !== null
    ? deadReckon(ac.lat, ac.lon, ac.gs, ac.track, elapsed)
    : [ac.lon, ac.lat];
}
const rad = (value: number) => (value * Math.PI) / 180;
const deg = (value: number) => (value * 180) / Math.PI;
const validCoordinates = (point: Coordinates) =>
  Number.isFinite(point.lat) &&
  Math.abs(point.lat) <= 90 &&
  Number.isFinite(point.lon) &&
  Math.abs(point.lon) <= 180;
const wrapLongitude = (lon: number) =>
  ((((lon + 180) % 360) + 360) % 360) - 180;
export function unwrapLine(points: Position[]): Position[] {
  const result: Position[] = [];
  for (const [longitude, lat] of points) {
    let lon = longitude;
    const previous = result[result.length - 1]?.[0];
    if (previous !== undefined) lon += Math.round((previous - lon) / 360) * 360;
    result.push([lon, lat]);
  }
  return result;
}
export function greatCircle(
  from: Coordinates,
  to: Coordinates,
  steps = 128,
): Position[] {
  if (!validCoordinates(from) || !validCoordinates(to)) return [];
  const vector = (point: Coordinates) => [
    Math.cos(rad(point.lat)) * Math.cos(rad(point.lon)),
    Math.cos(rad(point.lat)) * Math.sin(rad(point.lon)),
    Math.sin(rad(point.lat)),
  ];
  const a = vector(from),
    b = vector(to);
  const dot = Math.max(
    -1,
    Math.min(
      1,
      a.reduce((sum, value, i) => sum + value * b[i], 0),
    ),
  );
  const angle = Math.acos(dot);
  if (angle < 1e-8)
    return [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ];
  let tangent = b.map((value, i) => value - a[i] * dot);
  let length = Math.hypot(...tangent);
  if (length < 1e-8) {
    const axis = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    tangent = [
      a[1] * axis[2] - a[2] * axis[1],
      a[2] * axis[0] - a[0] * axis[2],
      a[0] * axis[1] - a[1] * axis[0],
    ];
    length = Math.hypot(...tangent);
  }
  tangent = tangent.map((value) => value / length);
  const count = Math.max(2, Number.isFinite(steps) ? Math.floor(steps) : 128);
  return Array.from({ length: count + 1 }, (_, i) => {
    if (i === 0) return [wrapLongitude(from.lon), from.lat];
    if (i === count) return [wrapLongitude(to.lon), to.lat];
    const t = (angle * i) / count;
    const v = a.map(
      (value, j) => value * Math.cos(t) + tangent[j] * Math.sin(t),
    );
    return [
      wrapLongitude(deg(Math.atan2(v[1], v[0]))),
      deg(Math.atan2(v[2], Math.hypot(v[0], v[1]))),
    ];
  });
}
export function splitAntimeridian(points: Position[]): Position[][] {
  if (!points.length) return [];
  const result: Position[][] = [[[wrapLongitude(points[0][0]), points[0][1]]]];
  for (const [rawLon, lat] of points.slice(1)) {
    const lon = wrapLongitude(rawLon);
    const previous = result[result.length - 1];
    const [lastLon, lastLat] = previous[previous.length - 1];
    if (Math.abs(lon - lastLon) > 180) {
      const unwrapped = lon + (lon < lastLon ? 360 : -360);
      const edge = lastLon >= 0 ? 180 : -180;
      const crossingLat =
        lastLat + ((lat - lastLat) * (edge - lastLon)) / (unwrapped - lastLon);
      previous.push([edge, crossingLat]);
      result.push([
        [-edge, crossingLat],
        [lon, lat],
      ]);
    } else previous.push([lon, lat]);
  }
  return result.filter((line) => line.length >= 2);
}
export function routeFeatures(
  route: FlightRoute | null,
  position: Coordinates | null,
): FeatureCollection<LineString | MultiLineString | Point> {
  const data: FeatureCollection<LineString | MultiLineString | Point> = {
    type: "FeatureCollection",
    features: [],
  };
  if (!route || !position || !validCoordinates(position)) return data;
  for (const [airport, leg] of [
    [route.origin, "flown"],
    [route.destination, "remaining"],
  ] as const) {
    if (
      !airport ||
      airport.lat === null ||
      airport.lon === null ||
      !validCoordinates({ lat: airport.lat, lon: airport.lon })
    )
      continue;
    const endpoint = { lat: airport.lat, lon: airport.lon };
    const points =
      leg === "flown"
        ? greatCircle(endpoint, position)
        : greatCircle(position, endpoint);
    data.features.push({
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: splitAntimeridian(points),
      },
      properties: { leg },
    });
    const codes = [airport.iata, airport.icao].filter(Boolean).join(" / ");
    data.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [airport.lon, airport.lat] },
      properties: {
        leg: "airport",
        label: [codes, airport.city ?? airport.name]
          .filter(Boolean)
          .join(" · "),
      },
    });
  }
  return data;
}
export function azimuthSector(home: Coordinates, point: Coordinates): number {
  if (!validCoordinates(home) || !validCoordinates(point)) return -1;
  const dLon = rad(point.lon - home.lon),
    a = rad(home.lat),
    b = rad(point.lat);
  const bearing =
    (deg(
      Math.atan2(
        Math.sin(dLon) * Math.cos(b),
        Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dLon),
      ),
    ) +
      360) %
    360;
  return Math.floor(((bearing + 1e-9) % 360) / 5);
}
export function sanitizeSectors(value: unknown): number[] {
  return Array.from({ length: 72 }, (_, i) =>
    Array.isArray(value) &&
    typeof value[i] === "number" &&
    Number.isFinite(value[i]) &&
    value[i] >= 0 &&
    value[i] <= 10808
      ? value[i]
      : 0,
  );
}
export function updateReceiverSectors(
  sectors: number[],
  home: Coordinates,
  aircraft: Aircraft[],
): number[] {
  const result = sanitizeSectors(sectors);
  if (!validCoordinates(home)) return result;
  for (const ac of aircraft) {
    if (
      ac.feedSource !== "local" ||
      ac.lat === null ||
      ac.lon === null ||
      !Number.isFinite(ac.lat) ||
      !Number.isFinite(ac.lon) ||
      Math.abs(ac.lat) > 90 ||
      Math.abs(ac.lon) > 180
    )
      continue;
    const point = { lat: ac.lat, lon: ac.lon };
    const index = azimuthSector(home, point);
    result[index] = Math.max(
      result[index],
      distanceNm(home.lat, home.lon, point.lat, point.lon),
    );
  }
  return result;
}
export function receiverRangeLine(
  home: Coordinates,
  sectors: number[],
): Position[] {
  const values = sanitizeSectors(sectors);
  if (!values.some((value) => value > 0) || !validCoordinates(home)) return [];
  const points = values.map((distance, i) =>
    destinationPoint(home.lat, home.lon, i * 5 + 2.5, distance),
  );
  return unwrapLine([...points, points[0]]);
}
export function solarPosition(date: Date): Coordinates {
  const n = date.getTime() / 86400_000 + 2440587.5 - 2451545;
  const anomaly = rad(357.528 + 0.9856003 * n);
  const longitude = rad(
    280.46 +
      0.9856474 * n +
      1.915 * Math.sin(anomaly) +
      0.02 * Math.sin(2 * anomaly),
  );
  const obliquity = rad(23.439 - 0.0000004 * n);
  const ascension = deg(
    Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude)),
  );
  return {
    lat: deg(Math.asin(Math.sin(obliquity) * Math.sin(longitude))),
    lon: wrapLongitude(ascension - (280.46061837 + 360.98564736629 * n)),
  };
}
export function nightPolygon(date: Date): FeatureCollection<Polygon> {
  const sun = solarPosition(date);
  const declination = rad(Math.abs(sun.lat) < 1e-6 ? 1e-6 : sun.lat);
  const edge: Position[] = Array.from({ length: 361 }, (_, i) => {
    const lon = i - 180;
    return [
      lon,
      deg(Math.atan(-Math.cos(rad(lon - sun.lon)) / Math.tan(declination))),
    ];
  });
  const pole = declination > 0 ? -90 : 90;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[...edge, [180, pole], [-180, pole], edge[0]]],
        },
      },
    ],
  };
}
type AltitudeGradient = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  number,
  string,
  ...(number | string)[],
];
export function trailGradient(
  points: { lon: number; lat: number; alt: Aircraft["alt_baro"] }[],
): AltitudeGradient {
  if (points.length < 2)
    return [
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      altitudeColor(points[0]?.alt ?? null),
      1,
      altitudeColor(points[0]?.alt ?? null),
    ];
  const coordinates = unwrapLine(points.map((point) => [point.lon, point.lat]));
  const mercatorY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + rad(Math.max(-85, Math.min(85, lat))) / 2));
  const distances = [0];
  for (let i = 1; i < coordinates.length; i++)
    distances.push(
      distances[i - 1] +
        Math.hypot(
          rad(coordinates[i][0] - coordinates[i - 1][0]),
          mercatorY(coordinates[i][1]) - mercatorY(coordinates[i - 1][1]),
        ),
    );
  const total = distances[distances.length - 1];
  const expression: AltitudeGradient = [
    "interpolate",
    ["linear"],
    ["line-progress"],
    0,
    altitudeColor(points[0].alt),
  ];
  for (let i = 1; i < points.length; i++) {
    if (distances[i] > distances[i - 1])
      expression.push(distances[i] / total, altitudeColor(points[i].alt));
  }
  if (!total) expression.push(1, altitudeColor(points[points.length - 1].alt));
  return expression;
}
