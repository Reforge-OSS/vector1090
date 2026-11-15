import { describe, expect, it } from "vitest";
import {
  channelType,
  nextAtcChannel,
  savedAtcChannels,
  sortAtcChannels,
  streamUrl,
  type AtcChannel,
} from "@/lib/atc";
import {
  icecastSources,
  mountPath,
  parseIcecast,
  parseIbonav,
} from "@/lib/atcProviders";
const source = {
  listenurl: "http://receiver:8000/tower?private=value",
  server_name: "Airport Tower",
  server_description: "118.500",
};
const channel = (id: string, patch: Partial<AtcChannel> = {}): AtcChannel => ({
  id,
  provider: "icecast",
  airportIcao: "EGLL",
  airportIata: "LHR",
  city: "London",
  country: "United Kingdom",
  name: id,
  frequency: "118.500",
  type: "tower",
  streamUrl: "/api/atc/stream?id=" + id,
  online: true,
  latitude: 51.47,
  longitude: -0.46,
  ...patch,
});
describe("ATC provider parsing", () => {
  it("normalizes Icecast object and array sources without publishing listen URLs", () => {
    const single = parseIcecast(
      { icestats: { source } },
      {
        "/tower": {
          name: "Main tower",
          icao: "EGLL",
          iata: "LHR",
          lat: 51.47,
          lon: -0.46,
        },
      },
    );
    expect(single[0]).toMatchObject({
      name: "Main tower",
      airportIcao: "EGLL",
      airportIata: "LHR",
      online: true,
      type: "tower",
      latitude: 51.47,
    });
    expect(single[0].streamUrl).toBe("/api/atc/stream?id=icecast%3A%2Ftower");
    expect(JSON.stringify(single)).not.toContain("private");
    const multi = parseIcecast(
      {
        icestats: {
          source: [source, { mount: "/ground", server_name: "Ground" }],
        },
      },
      { "/offline": "Backup" },
      { "/tower": "EGLL", "/ground": "EHAM" },
    );
    expect(multi.map((c) => [c.airportIcao, c.online])).toEqual([
      ["EGLL", true],
      ["EHAM", true],
      [null, false],
    ]);
    expect(multi[1].type).toBe("ground");
    expect(parseIcecast(null)).toEqual([]);
    expect(icecastSources({ icestats: { source: [null, {}, 5] } }).size).toBe(
      0,
    );
  });
  it.each([
    "//evil/stream",
    "/../admin",
    "/x?secret=value",
    "/x#hash",
    "/" + "x".repeat(201),
    "https://evil/stream",
  ])("rejects unsafe mounts %s", (mount) =>
    expect(mountPath(mount)).toBeNull(),
  );
  it("parses real ibonav page structure, airport metadata and offline mounts", () => {
    const pages = [
      {
        ident: "ltac",
        name: "LTAC/ESB - Ankara Esenboğa International Airport",
        category: "aerodrome",
        "ais-settings": {
          "show-on-map": { "center-lat": "40.1281", "center-long": "32.9950" },
        },
        channels: [
          {
            url: "LTAC-TWR-118-100",
            type: "aerodrome",
            freq: "118.100 MHz",
            "ad-2-18": [{ "_2-call-sign": "Esenboğa Tower" }],
          },
          {
            url: "LTAC-GND-121-900",
            type: "aerodrome",
            name: "Ground",
            freq: "121.900 MHz",
          },
          { url: "https://evil/stream" },
        ],
      },
    ];
    const result = parseIbonav(pages, {
      icestats: {
        source: {
          listenurl:
            "https://atc1.ibosoft.net.tr:2096/LTAC-TWR-118-100?access_token=private",
        },
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      provider: "ibonav",
      airportIcao: "LTAC",
      airportIata: "ESB",
      city: "Ankara",
      country: "Türkiye",
      name: "Esenboğa Tower",
      type: "tower",
      online: true,
      latitude: 40.1281,
    });
    expect(result[1]).toMatchObject({ type: "ground", online: false });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(parseIbonav({}, {})).toEqual([]);
    expect(
      parseIbonav(
        [
          {
            ident: "LTAA",
            category: "airspace",
            channels: [{ url: "ACC", type: "fir" }],
          },
        ],
        {},
      )[0],
    ).toMatchObject({ airportIcao: null, type: "control", online: false });
  });
  it("keeps unknown coordinates unknown and detects explicit service types before generic types", () => {
    expect(
      parseIcecast(
        { icestats: { source } },
        { "/tower": { lat: 200, lon: "", icao: "bad" } },
      )[0],
    ).toMatchObject({ latitude: null, longitude: null, airportIcao: null });
    expect(channelType("LTAC-APP-119-100 aerodrome")).toBe("approach");
  });
});
describe("failover", () => {
  const first = channel("first"),
    same = channel("same"),
    other = channel("remote", { provider: "ibonav" }),
    approach = channel("approach", { type: "approach" });
  it("prefers the same airport and service, then tries another provider with backoff", () => {
    const channels = [
      channel("offline", { online: false }),
      channel("elsewhere", { airportIcao: "KJFK" }),
      approach,
      other,
      same,
    ];
    expect(nextAtcChannel(channels, first, new Set(["first"]))).toEqual({
      channel: same,
      delayMs: 1000,
    });
    expect(nextAtcChannel(channels, same, new Set(["first", "same"]))).toEqual({
      channel: other,
      delayMs: 2000,
    });
    expect(
      nextAtcChannel(channels, other, new Set(["first", "same", "remote"])),
    ).toEqual({ channel: approach, delayMs: 4000 });
  });
  it("never loops, mixes unknown airports, or exceeds four attempts", () => {
    expect(nextAtcChannel([first], first, new Set(["first"]))).toBeNull();
    expect(
      nextAtcChannel([same], first, new Set(["a", "b", "c", "d"])),
    ).toBeNull();
    expect(
      nextAtcChannel(
        [same],
        channel("unknown", { airportIcao: null, airportIata: null }),
        new Set(),
      ),
    ).toBeNull();
    expect(nextAtcChannel([], first, new Set())).toBeNull();
  });
});
it("searches all channel metadata and sorts known locations by distance, unknown locations last", () => {
  const a = channel("a"),
    b = channel("b", {
      latitude: 40.64,
      longitude: -73.78,
      airportIcao: "KJFK",
      airportIata: "JFK",
      city: "New York",
      country: "United States",
    }),
    unknown = channel("c", { latitude: null });
  for (const query of [
    "egll",
    "LHR",
    "london",
    "kingdom",
    "118.5",
    "own receiver",
  ])
    expect(sortAtcChannels([a], query, null)).toEqual([a]);
  expect(
    sortAtcChannels([a, unknown, b], "", { lat: 40.6, lon: -73.7 }),
  ).toEqual([b, a, unknown]);
  expect(sortAtcChannels([a], "no match", null)).toEqual([]);
});
it("validates saved channels, deduplicates URLs, and drops prohibited legacy streams", () => {
  expect(streamUrl("javascript:alert(1)")).toBeNull();
  expect(streamUrl("https://name:password@receiver/stream")).toBeNull();
  expect(streamUrl("https://s1.liveatc.net/mount")).toBeNull();
  expect(
    savedAtcChannels([
      null,
      { streamUrl: "data:abc" },
      {
        streamUrl: "https://receiver/tower",
        airportIcao: "egll",
        type: "tower",
      },
      { streamUrl: "https://receiver/tower" },
    ]),
  ).toHaveLength(1);
  expect(savedAtcChannels(null)).toEqual([]);
});
