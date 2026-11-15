import { describe, expect, it } from "vitest";
import { normalizeAircraft, normalizeFeed } from "@/lib/normalize";
import {
  circlePolygon,
  deadReckon,
  destinationPoint,
  distanceNm,
} from "@/lib/geo";
import {
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatVerticalRate,
} from "@/lib/units";
import {
  altitudeColor,
  EMERGENCY_COLOR,
  iconKind,
  isEmergency,
} from "@/lib/aircraftStyle";
import { aircraftDistance, filterAircraft } from "@/lib/filters";
import type { Aircraft } from "@/lib/types";

describe("normalization", () => {
  it.each([null, undefined, {}, { hex: " " }])(
    "drops aircraft without an identifier: %j",
    (value) => {
      expect(normalizeAircraft(value)).toBeNull();
    },
  );
  it("normalizes receiver fields, fallbacks and flags without discarding zero", () => {
    expect(
      normalizeAircraft({
        hex: " ABC123 ",
        flight: " TEST ",
        r: "G-TEST",
        t: "A320",
        dbFlags: 3,
        true_heading: 90,
        geom_rate: 100,
        lastPosition: { lat: 52, lon: -1 },
        gs: 0,
      }),
    ).toMatchObject({
      hex: "abc123",
      flight: "TEST",
      reg: "G-TEST",
      type: "A320",
      isMilitary: true,
      isInteresting: true,
      track: 90,
      baro_rate: 100,
      lat: 52,
      lon: -1,
      gs: 0,
      alt_baro: null,
    });
    expect(
      normalizeAircraft({ hex: "abc123", track: 0, true_heading: 90 })?.track,
    ).toBe(0);
    expect(normalizeAircraft({ hex: "abc123", mag_heading: 10 })?.track).toBe(
      10,
    );
    expect(
      normalizeAircraft({
        hex: "abc123",
        alt_baro: "ground",
        gs: NaN,
        flight: "",
      }),
    ).toMatchObject({ alt_baro: "ground", gs: null, flight: null });
  });
  it.each(["ac", "aircraft"])("accepts the %s feed shape", (key) => {
    expect(normalizeFeed({ [key]: [{ hex: "abc123" }, {}] })).toHaveLength(1);
  });
  it.each([null, {}, { ac: "invalid" }])(
    "handles empty or malformed feeds: %j",
    (value) => {
      expect(normalizeFeed(value)).toEqual([]);
    },
  );
});

describe("geometry and units", () => {
  it("calculates distances, closed rings and dead reckoning in [longitude, latitude] order", () => {
    expect(distanceNm(0, 0, 0, 0)).toBe(0);
    const point = destinationPoint(52, -1, 90, 60);
    expect(distanceNm(52, -1, point[1], point[0])).toBeCloseTo(60, 8);
    expect(deadReckon(52, -1, 60, 90, 3600)).toEqual(point);
    const ring = circlePolygon(52, -1, 50);
    expect(ring).toHaveLength(129);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(circlePolygon(52, -1, 50, 1)).toHaveLength(4);
  });
  it("formats both unit systems and missing values", () => {
    expect(formatAltitude("ground", "aviation")).toBe("Ground");
    expect(formatAltitude(1000, "metric")).toBe("305 m");
    expect(formatAltitude(1000, "aviation")).toBe("1,000 ft");
    expect(formatSpeed(100, "metric")).toBe("185 km/h");
    expect(formatSpeed(100, "aviation")).toBe("100 kts");
    expect(formatDistance(10, "metric")).toBe("18.5 km");
    expect(formatDistance(10, "aviation")).toBe("10.0 nm");
    expect(formatVerticalRate(1000, "metric")).toBe("5.1 m/s");
    expect(formatVerticalRate(-1000, "aviation")).toBe("-1,000 fpm");
    for (const format of [
      formatAltitude,
      formatSpeed,
      formatDistance,
      formatVerticalRate,
    ]) {
      expect(format(null, "aviation")).toBe("—");
    }
  });
});

function aircraft(patch: Partial<Aircraft> = {}): Aircraft {
  return { ...normalizeAircraft({ hex: "abc123" })!, ...patch };
}

describe("aircraft presentation", () => {
  it.each([
    ["ground", "#909093"],
    [null, "#909093"],
    [4999, "#a8c3a0"],
    [5000, "#e2c799"],
    [10000, "#9fb8d8"],
    [25000, "#b8acd9"],
  ] as const)("colors altitude %s", (altitude, color) => {
    expect(altitudeColor(altitude)).toBe(color);
  });
  it.each(["7500", "7600", "7700"])(
    "recognizes emergency squawk %s",
    (squawk) => {
      expect(isEmergency(squawk)).toBe(true);
    },
  );
  it("does not flag ordinary or missing squawks", () => {
    expect(isEmergency(null)).toBe(false);
    expect(isEmergency("7000")).toBe(false);
    expect(EMERGENCY_COLOR).toBe("#e59a9a");
  });
  it.each([
    ["A7", "helicopter"],
    ["A5", "heavy"],
    ["A4", "jet"],
    ["A3", "jet"],
    ["A2", "light"],
    [null, "jet"],
  ])("chooses an icon for category %s", (category, expected) => {
    expect(iconKind(aircraft({ category }))).toBe(expected);
    expect(iconKind(aircraft({ category, isMilitary: true }))).toBe("military");
  });
});

describe("search and filters", () => {
  const home = { homeLat: 52, homeLon: -1 };
  const entries = [
    aircraft({
      hex: "abc123",
      flight: "RYR123",
      reg: "EI-TEST",
      type: "B738",
      alt_baro: 14000,
      lat: 53,
      lon: -1,
    }),
    aircraft({
      hex: "def456",
      flight: "VIP",
      alt_baro: 15000,
      lat: 52,
      lon: -1,
      isMilitary: true,
    }),
    aircraft({ hex: "fed987", alt_baro: "ground", squawk: "7700" }),
    aircraft({ hex: "bad123" }),
  ];
  it.each(["ryr", "ABC", "ei-test", "b738", " RYR123 "])(
    "searches normalized fields: %s",
    (term) => {
      expect(
        filterAircraft(entries, term, "all", home).map((ac) => ac.hex),
      ).toEqual(["abc123"]);
    },
  );
  it("combines filters and sorts known positions nearest first", () => {
    expect(filterAircraft(entries, "", "all", home)[0].hex).toBe("def456");
    expect(
      filterAircraft(entries, "", "low", home).map((ac) => ac.hex),
    ).toEqual(["abc123", "fed987"]);
    expect(filterAircraft(entries, " VIP ", "military", home)).toHaveLength(1);
    expect(filterAircraft(entries, "", "emergency", home)[0].hex).toBe(
      "fed987",
    );
    expect(filterAircraft(entries, "RYR", "military", home)).toEqual([]);
    expect(aircraftDistance(entries[2], home)).toBeNull();
  });
  it("handles empty inputs and searches with no results", () => {
    expect(filterAircraft([], "", "all", home)).toEqual([]);
    expect(filterAircraft(entries, "missing", "all", home)).toEqual([]);
  });
});
