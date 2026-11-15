import { describe, expect, it } from "vitest";
import { parseMapState, serializeMapState } from "@/lib/mapState";
import {
  azimuthSector,
  aircraftPosition,
  greatCircle,
  nightPolygon,
  receiverRangeLine,
  routeFeatures,
  sanitizeSectors,
  solarPosition,
  splitAntimeridian,
  trailGradient,
  unwrapLine,
  updateReceiverSectors,
} from "@/lib/mapGeometry";
import { destinationPoint, distanceNm } from "@/lib/geo";
import { normalizeAircraft } from "@/lib/normalize";
import { iconKind } from "@/lib/aircraftStyle";
import { rainviewerTiles } from "@/lib/weather";
import type { FlightRoute } from "@/lib/intelligence";

const london = { lat: 51.4706, lon: -0.46194 },
  newYork = { lat: 40.6398, lon: -73.7789 };
const route: FlightRoute = {
  callsign: "BAW117",
  airline: null,
  origin: {
    ...london,
    icao: "EGLL",
    iata: "LHR",
    name: "Heathrow",
    city: "London",
    country: "United Kingdom",
  },
  destination: {
    ...newYork,
    icao: "KJFK",
    iata: "JFK",
    name: "John F Kennedy",
    city: "New York",
    country: "United States",
  },
};
describe("shared map URLs", () => {
  it("restores valid selection, camera, zero coordinates and filters", () => {
    expect(
      parseMapState("?hex=ABC123&lat=0&lon=0&zoom=0&filter=watchlist"),
    ).toEqual({
      selectedHex: "abc123",
      camera: { lat: 0, lon: 0, zoom: 0 },
      filter: "watchlist",
    });
    expect(parseMapState("?lat=51&lon=-1").camera?.zoom).toBe(8);
  });
  it.each([
    "",
    "?hex=xyz&lat=&lon=0&filter=bad",
    "?lat=91&lon=0",
    "?lat=0&lon=181",
    "?lat=NaN&lon=0",
    "?lat=0",
    "?lon=0",
  ])("ignores empty or malformed URL values: %s", (query) => {
    expect(parseMapState(query)).toEqual({
      selectedHex: null,
      camera: null,
      filter: "all",
    });
  });
  it("limits zoom and ignores non-finite zoom", () => {
    expect(parseMapState("?lat=0&lon=0&zoom=100").camera?.zoom).toBe(22);
    expect(parseMapState("?lat=0&lon=0&zoom=-5").camera?.zoom).toBe(0);
    expect(parseMapState("?lat=0&lon=0&zoom=Infinity").camera?.zoom).toBe(8);
  });
  it("round trips at share precision, removes cleared keys and preserves unrelated parameters", () => {
    const query = serializeMapState(
      {
        selectedHex: "ABC123",
        camera: { lat: 51.123456, lon: -0.987654, zoom: 7.3456 },
        filter: "low",
      },
      "?utm_source=test&hex=ffffff&filter=military",
    );
    expect(parseMapState(query)).toEqual({
      selectedHex: "abc123",
      camera: { lat: 51.1235, lon: -0.9877, zoom: 7.35 },
      filter: "low",
    });
    expect(new URLSearchParams(query).get("utm_source")).toBe("test");
    expect(
      serializeMapState(
        { selectedHex: null, camera: null, filter: "all" },
        query,
      ),
    ).toBe("?utm_source=test");
  });
});
describe("great-circle routes", () => {
  it("keeps the selected trail and route attached to the extrapolated aircraft", () => {
    const ac = normalizeAircraft({
      hex: "abc123",
      lat: 0,
      lon: 0,
      gs: 360,
      track: 90,
      alt_baro: 10000,
      seen: 0,
    })!;
    const point = aircraftPosition(ac, 0, 10_000)!;
    expect(distanceNm(0, 0, point[1], point[0])).toBeCloseTo(1);
    expect(aircraftPosition({ ...ac, alt_baro: "ground" }, 0, 10_000)).toEqual([
      0, 0,
    ]);
    expect(aircraftPosition({ ...ac, lat: null }, 0, 10_000)).toBeNull();
    expect(
      distanceNm(
        0,
        0,
        ...(aircraftPosition(ac, 0, 120_000)!.slice().reverse() as [
          number,
          number,
        ]),
      ),
    ).toBeCloseTo(6);
  });
  it("uses the northern great-circle arc and equally spaced points", () => {
    const points = greatCircle(london, newYork);
    expect(points).toHaveLength(129);
    expect(points[0][0]).toBeCloseTo(london.lon);
    expect(points.at(-1)![0]).toBeCloseTo(newYork.lon);
    expect(points[64][1]).toBeGreaterThan(51);
    const distances = points
      .slice(1)
      .map(([lon, lat], i) => distanceNm(points[i][1], points[i][0], lat, lon));
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(1e-6);
  });
  it.each([
    [
      [0, 0],
      [180, 0],
    ],
    [
      [0, 90],
      [0, -90],
    ],
    [
      [179, 20],
      [-179, 21],
    ],
    [
      [0, 0],
      [0, 0],
    ],
  ])(
    "handles antipodes, poles, crossings and coincident endpoints: %j",
    (a, b) => {
      const points = greatCircle(
        { lat: a[1], lon: a[0] },
        { lat: b[1], lon: b[0] },
      );
      expect(points.flat().every(Number.isFinite)).toBe(true);
      for (const line of splitAntimeridian(points))
        for (let i = 1; i < line.length; i++)
          expect(Math.abs(line[i][0] - line[i - 1][0])).toBeLessThanOrEqual(
            180,
          );
    },
  );
  it("splits date-line crossings at matching +/-180 boundaries", () => {
    const lines = splitAntimeridian([
      [179, 10],
      [-179, 12],
    ]);
    expect(lines).toEqual([
      [
        [179, 10],
        [180, 11],
      ],
      [
        [-180, 11],
        [-179, 12],
      ],
    ]);
    expect(splitAntimeridian([])).toEqual([]);
    expect(
      unwrapLine([
        [179, 10],
        [-179, 12],
        [-178, 13],
      ]),
    ).toEqual([
      [179, 10],
      [181, 12],
      [182, 13],
    ]);
    expect(greatCircle({ lat: NaN, lon: 0 }, london)).toEqual([]);
  });
  it("builds both legs and labeled airports, and clears absent or invalid routes", () => {
    const data = routeFeatures(route, { lat: 50, lon: -20 });
    expect(data.features.map((feature) => feature.properties?.leg)).toEqual([
      "flown",
      "airport",
      "remaining",
      "airport",
    ]);
    expect(data.features[1].properties?.label).toBe("LHR / EGLL · London");
    expect(data.features[3].properties?.label).toBe("JFK / KJFK · New York");
    expect(routeFeatures(null, london).features).toEqual([]);
    expect(routeFeatures(route, null).features).toEqual([]);
    expect(routeFeatures(route, { lat: 100, lon: 0 }).features).toEqual([]);
    expect(
      routeFeatures({ ...route, origin: null, destination: null }, london)
        .features,
    ).toEqual([]);
  });
});
describe("receiver range", () => {
  it.each([
    [0, 0],
    [4.99, 0],
    [5.01, 1],
    [90, 18],
    [180, 36],
    [270, 54],
    [359, 71],
  ])("assigns bearing %s to 5-degree sector %s", (bearing, sector) => {
    const [lon, lat] = destinationPoint(london.lat, london.lon, bearing, 100);
    expect(azimuthSector(london, { lat, lon })).toBe(sector);
  });
  it("keeps local maxima only, without mutating input", () => {
    const point = (nm: number, source: "local" | "public") => {
      const [lon, lat] = destinationPoint(london.lat, london.lon, 92, nm);
      return normalizeAircraft({ hex: "abc123", lat, lon }, source)!;
    };
    const initial = sanitizeSectors(null);
    const sectors = updateReceiverSectors(initial, london, [
      point(30, "local"),
      point(10, "local"),
      point(100, "public"),
    ]);
    expect(sectors[18]).toBeCloseTo(30);
    expect(initial[18]).toBe(0);
    expect(
      updateReceiverSectors(sectors, london, [point(20, "local")])[18],
    ).toBeCloseTo(30);
    expect(receiverRangeLine(london, sectors)).toHaveLength(73);
    expect(receiverRangeLine(london, initial)).toEqual([]);
    expect(receiverRangeLine(london, [Infinity])).toEqual([]);
  });
  it("rejects corrupt storage and invalid coordinates", () => {
    expect(sanitizeSectors([NaN, Infinity, -1, "2", 50]).slice(0, 6)).toEqual([
      0, 0, 0, 0, 50, 0,
    ]);
    expect(sanitizeSectors({})).toEqual(Array(72).fill(0));
    expect(azimuthSector(london, { lat: 100, lon: 0 })).toBe(-1);
    const invalid = normalizeAircraft(
      { hex: "abc123", lat: 100, lon: 0 },
      "local",
    )!;
    expect(updateReceiverSectors([], london, [invalid])).toEqual(
      Array(72).fill(0),
    );
  });
});
describe("solar terminator and altitude gradient", () => {
  it("places the subsolar point at noon and reverses the shaded pole by season", () => {
    const june = new Date("2026-06-21T12:00:00Z"),
      december = new Date("2026-12-21T12:00:00Z");
    expect(solarPosition(june).lat).toBeCloseTo(23.44, 0);
    expect(Math.abs(solarPosition(june).lon)).toBeLessThan(1);
    expect(solarPosition(december).lat).toBeCloseTo(-23.44, 0);
    for (const [date, pole] of [
      [june, -90],
      [december, 90],
    ] as const) {
      const ring = nightPolygon(date).features[0].geometry.coordinates[0];
      expect(ring.at(-1)).toEqual(ring[0]);
      expect(ring.at(-2)![1]).toBe(pole);
      expect(ring.flat().every(Number.isFinite)).toBe(true);
    }
    expect(
      nightPolygon(new Date("2026-03-20T12:00:00Z"))
        .features[0].geometry.coordinates[0].flat()
        .every(Number.isFinite),
    ).toBe(true);
  });
  it("creates ordered line-progress stops using pastel altitude bands, even across the date line", () => {
    const expression = trailGradient([
      { lon: 179, lat: 0, alt: "ground" },
      { lon: -180, lat: 0, alt: 4000 },
      { lon: -179, lat: 0, alt: 30000 },
    ]);
    expect(expression).toEqual([
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      "#909093",
      0.5,
      "#a8c3a0",
      1,
      "#b8acd9",
    ]);
    expect(trailGradient([]).at(-2)).toBe(1);
    const duplicate = trailGradient([
      { lon: 0, lat: 0, alt: 10000 },
      { lon: 0, lat: 0, alt: 20000 },
    ]);
    expect(duplicate.at(-2)).toBe(1);
  });
});
describe("RainViewer and icons", () => {
  it("uses the newest past frame, never nowcast", () => {
    expect(
      rainviewerTiles({
        host: "https://tilecache.rainviewer.com",
        radar: {
          past: [
            { time: 2, path: "/v2/radar/new" },
            { time: 1, path: "/v2/radar/old" },
          ],
          nowcast: [{ time: 3, path: "/v2/radar/future" }],
        },
      }),
    ).toBe(
      "https://tilecache.rainviewer.com/v2/radar/new/256/{z}/{x}/{y}/2/1_1.png",
    );
  });
  it.each([
    null,
    {},
    { host: "https://evil.example", radar: { past: [] } },
    { host: "https://tilecache.rainviewer.com", radar: { past: [] } },
    {
      host: "https://tilecache.rainviewer.com",
      radar: { past: [{ time: 1, path: "/other" }] },
    },
  ])("rejects absent or malformed weather metadata: %j", (value) =>
    expect(rainviewerTiles(value)).toBeNull(),
  );
  it("recognizes surface vehicles and unknown emitters", () => {
    expect(
      iconKind(normalizeAircraft({ hex: "abc123", category: "C2" })!),
    ).toBe("vehicle");
    expect(
      iconKind(normalizeAircraft({ hex: "abc123", category: "A0" })!),
    ).toBe("unknown");
  });
});
