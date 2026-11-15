import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FeedProxy } from "@/lib/feedProxy";
import {
  clampViewportRadius,
  mergeFeeds,
  normalizePublicQuery,
  viewportQuery,
  viewportRadius,
} from "@/lib/feeds";
import { normalizeAircraft } from "@/lib/normalize";
import { distanceNm } from "@/lib/geo";
import type { PublicQuery } from "@/lib/types";

const area: PublicQuery = {
  scope: "area",
  lat: 40.64,
  lon: -73.78,
  radius: 80,
};
const otherArea: PublicQuery = { scope: "area", lat: 51, lon: 0, radius: 50 };
const fetcher = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01"));
  vi.stubEnv("ADSB_API_BASE", "https://api.adsb.lol");
  fetcher.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("feed merging and normalization", () => {
  it("deduplicates identifiers, tags origins and prefers the entire local record", () => {
    const local = normalizeAircraft(
      { hex: "ABC123", flight: "LOCAL", alt_baro: 1234 },
      "local",
    )!;
    const remote = normalizeAircraft({
      hex: "abc123",
      flight: "PUBLIC",
      alt_baro: 30000,
    })!;
    const remoteOnly = normalizeAircraft({ hex: "def456" })!;
    expect(mergeFeeds([local], [remote, remoteOnly])).toEqual([
      local,
      remoteOnly,
    ]);
    expect(mergeFeeds([], [])).toEqual([]);
    expect(mergeFeeds([], [remote, remote])).toEqual([remote]);
    expect(mergeFeeds([local], [])).toEqual([local]);
  });
  it("keeps aircraft type separate from position source and maps extended telemetry", () => {
    expect(
      normalizeAircraft(
        {
          hex: "abc123",
          t: "B738",
          type: "mlat",
          dbFlags: 15,
          rssi: -19.2,
          ias: 220,
          tas: 240,
          mach: 0.72,
          alt_geom: 34000,
          nav_altitude_mcp: 35000,
          nav_qnh: 1013.2,
          nav_modes: ["autopilot", "vnav", 42],
          wd: 90,
          ws: 15,
          roll: 0,
          mag_heading: 130,
          true_heading: 135,
          messages: 12345,
        },
        "local",
      ),
    ).toMatchObject({
      type: "B738",
      positionSource: "mlat",
      feedSource: "local",
      isMilitary: true,
      isInteresting: true,
      isPIA: true,
      isLADD: true,
      rssi: -19.2,
      ias: 220,
      tas: 240,
      mach: 0.72,
      alt_geom: 34000,
      nav_altitude_mcp: 35000,
      nav_qnh: 1013.2,
      nav_modes: ["autopilot", "vnav"],
      wind_dir: 90,
      wind_speed: 15,
      roll: 0,
      mag_heading: 130,
      true_heading: 135,
      messages: 12345,
    });
    const empty = normalizeAircraft({
      hex: "abc123",
      rssi: Infinity,
      nav_modes: "invalid",
      messages: "123",
    })!;
    for (const field of [
      "rssi",
      "ias",
      "tas",
      "mach",
      "alt_geom",
      "nav_altitude_mcp",
      "nav_qnh",
      "nav_modes",
      "wind_dir",
      "wind_speed",
      "roll",
      "mag_heading",
      "true_heading",
      "positionSource",
      "messages",
    ] as const)
      expect(empty[field]).toBeNull();
    expect(empty.isPIA).toBe(false);
    expect(empty.isLADD).toBe(false);
    expect(normalizeAircraft({ hex: "abc123", dbFlags: 4 })).toMatchObject({
      isPIA: true,
      isLADD: false,
    });
    expect(normalizeAircraft({ hex: "abc123", dbFlags: 8 })).toMatchObject({
      isPIA: false,
      isLADD: true,
    });
  });
});

describe("viewport queries", () => {
  it("covers the requested circle after shifting its center, up to the API cap", () => {
    for (const radius of [25, 50, 100, 150, 245, 250]) {
      const query = { scope: "area" as const, lat: 0.124, lon: 0.124, radius };
      const normalized = normalizePublicQuery(query);
      if (normalized.scope !== "area") throw new Error("Expected area");
      const shift = distanceNm(
        query.lat,
        query.lon,
        normalized.lat,
        normalized.lon,
      );
      expect(normalized.radius).toBeGreaterThanOrEqual(
        Math.min(250, radius + shift),
      );
      expect(normalized.radius).toBeLessThanOrEqual(250);
    }
    expect(
      normalizePublicQuery({ scope: "area", lat: 0, lon: 0, radius: 25 }),
    ).toEqual({ scope: "area", lat: 0, lon: 0, radius: 25 });
  });
  it.each([
    [-1, 1],
    [0, 1],
    [1.1, 2],
    [80, 80],
    [900, 250],
    [Infinity, 250],
    [NaN, 250],
  ])("clamps radius %s to %s", (radius, expected) => {
    expect(clampViewportRadius(radius)).toBe(expected);
  });
  it("uses the farthest corner, area scope at zoom 5, and global below it", () => {
    const center = { lat: 0, lon: 0 };
    const bounds = { west: -1, east: 2, south: -1, north: 2 };
    const query = viewportQuery(center, bounds, 5);
    expect(query).toEqual({
      scope: "area",
      ...center,
      radius: Math.ceil(viewportRadius(center, bounds)),
    });
    expect(viewportQuery(center, bounds, 4.99)).toEqual({ scope: "global" });
    expect(
      viewportQuery(
        center,
        { west: -170, east: 170, south: -80, north: 80 },
        5,
      ),
    ).toMatchObject({ radius: 250 });
    expect(
      viewportRadius(
        { lat: 0, lon: 180 },
        { west: 179, east: 181, south: -1, north: 1 },
      ),
    ).toBeLessThan(90);
  });
  it("groups nearby area requests and ignores location for global queries", () => {
    expect(normalizePublicQuery(area)).toEqual({
      scope: "area",
      lat: 40.75,
      lon: -73.75,
      radius: 100,
    });
    expect(
      normalizePublicQuery({
        scope: "area",
        lat: 40.66,
        lon: -73.79,
        radius: 90,
      }),
    ).toEqual(normalizePublicQuery(area));
    expect(normalizePublicQuery({ scope: "global" })).toEqual({
      scope: "global",
    });
  });
});

describe("shared upstream protection", () => {
  it.each(["/v2/mil", "/v2/sqk/7700"])(
    "prefers fresh telemetry over a duplicate cached observation from %s",
    async (limitedPath) => {
      const proxy = new FeedProxy(fetcher);
      fetcher.mockImplementation(async () =>
        Response.json({
          ac: [
            {
              hex: "abc123",
              squawk: "7700",
              lat: 40,
              lon: -74,
              alt_baro: 10000,
              seen: 0,
            },
          ],
        }),
      );
      await proxy.publicFeed({ scope: "global" });
      vi.setSystemTime(Date.now() + 8001);
      fetcher.mockImplementation(async (url) =>
        String(url).endsWith(limitedPath)
          ? new Response(null, {
              status: 429,
              headers: { "Retry-After": "12" },
            })
          : Response.json({
              ac: [
                {
                  hex: "abc123",
                  squawk: "7700",
                  lat: 41,
                  lon: -73,
                  alt_baro: 9000,
                  seen: 0,
                },
              ],
            }),
      );
      const result = await proxy.publicFeed({ scope: "global" });
      expect(result.status).toBe("rate_limited");
      expect(result.aircraft).toHaveLength(1);
      expect(result.aircraft[0]).toMatchObject({
        hex: "abc123",
        squawk: "7700",
        lat: 41,
        lon: -73,
        alt_baro: 9000,
        seen: 0,
        stale: false,
      });
    },
  );
  it.each(["/v2/mil", "/v2/sqk/7700"])(
    "retains fresh global aircraft when %s is rate limited",
    async (limitedPath) => {
      const proxy = new FeedProxy(fetcher);
      fetcher.mockImplementation(async (url) =>
        Response.json({
          ac: [
            {
              hex: String(url).endsWith(limitedPath) ? "abc123" : "def456",
              seen: 0,
            },
          ],
        }),
      );
      await proxy.publicFeed({ scope: "global" });
      vi.setSystemTime(Date.now() + 8001);
      fetcher.mockImplementation(async (url) =>
        String(url).endsWith(limitedPath)
          ? new Response(null, {
              status: 429,
              headers: { "Retry-After": "12" },
            })
          : Response.json({ ac: [{ hex: "fed321", squawk: "7700", seen: 0 }] }),
      );
      const result = await proxy.publicFeed({ scope: "global" });
      expect(result).toMatchObject({
        status: "rate_limited",
        stale: true,
        retryAfter: 12,
      });
      expect(result.aircraft.map((ac) => ac.hex).sort()).toEqual([
        "abc123",
        "fed321",
      ]);
      expect(
        result.aircraft.find((ac) => ac.hex === "abc123")!.seen,
      ).toBeCloseTo(8.001);
      const cooldown = await proxy.publicFeed({ scope: "global" });
      expect(cooldown.aircraft.map((ac) => ac.hex)).toEqual(
        result.aircraft.map((ac) => ac.hex),
      );
      expect(cooldown.aircraft.every((ac) => ac.stale)).toBe(true);
      expect(result.aircraft.find((ac) => ac.hex === "fed321")!.stale).toBe(
        false,
      );
      expect(result.aircraft.find((ac) => ac.hex === "abc123")!.stale).toBe(
        true,
      );
      expect(fetcher).toHaveBeenCalledTimes(4);
    },
  );
  it("keeps a successful global subfeed without a previous cache entry", async () => {
    fetcher
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ac: [{ hex: "fed321" }] }));
    const result = await new FeedProxy(fetcher).publicFeed({ scope: "global" });
    expect(result).toMatchObject({
      status: "rate_limited",
      available: true,
      aircraft: [{ hex: "fed321" }],
    });
  });
  it("coalesces normalized concurrent requests and caches them for eight seconds", async () => {
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const proxy = new FeedProxy(fetcher);
    const first = proxy.publicFeed(area);
    const second = proxy.publicFeed({
      scope: "area",
      lat: 40.66,
      lon: -73.79,
      radius: 90,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.adsb.lol/v2/lat/40.75/lon/-73.75/dist/100",
    );
    finish(Response.json({ ac: [{ hex: "abc123" }], now: Date.now() }));
    const [a, b] = await Promise.all([first, second]);
    expect(a.cache).toBe("miss");
    expect(b.cache).toBe("coalesced");
    expect(a.now).toBe(Date.now() / 1000);
    expect((await proxy.publicFeed(area)).cache).toBe("hit");
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 8001);
    fetcher.mockResolvedValueOnce(Response.json({ ac: [] }));
    expect((await proxy.publicFeed(area)).aircraft).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("expires local results after one second independently of public results", async () => {
    fetcher.mockImplementation(async () =>
      Response.json({ aircraft: [{ hex: "abc123" }] }),
    );
    const proxy = new FeedProxy(fetcher);
    await proxy.publicFeed(area);
    expect(
      (await proxy.localFeed("http://receiver/feed")).aircraft[0].feedSource,
    ).toBe("local");
    expect((await proxy.localFeed("http://receiver/feed")).cache).toBe("hit");
    vi.setSystemTime(Date.now() + 1001);
    expect((await proxy.localFeed("http://receiver/feed")).cache).toBe("miss");
    expect((await proxy.publicFeed(area)).cache).toBe("hit");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("fetches only military and 7700 globally, in parallel, and coalesces duplicate global requests", async () => {
    const resolvers: ((response: Response) => void)[] = [];
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const proxy = new FeedProxy(fetcher);
    const first = proxy.publicFeed({ scope: "global" });
    const second = proxy.publicFeed({ scope: "global" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.adsb.lol/v2/mil",
      "https://api.adsb.lol/v2/sqk/7700",
    ]);
    resolvers[0](Response.json({ ac: [{ hex: "abc123", dbFlags: 1 }] }));
    resolvers[1](
      Response.json({
        ac: [
          { hex: "abc123", squawk: "7700" },
          { hex: "def456", squawk: "7700" },
        ],
      }),
    );
    const [result] = await Promise.all([first, second]);
    expect(result.aircraft).toHaveLength(2);
    expect(result.aircraft.every((ac) => ac.feedSource === "public")).toBe(
      true,
    );
    expect((await proxy.publicFeed({ scope: "global" })).cache).toBe("hit");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("applies a global cooldown, serves last-good data as stale and keeps local working", async () => {
    const proxy = new FeedProxy(fetcher);
    fetcher.mockResolvedValueOnce(Response.json({ ac: [{ hex: "abc123" }] }));
    await proxy.publicFeed(area);
    vi.setSystemTime(Date.now() + 8001);
    fetcher.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "12" } }),
    );
    expect(await proxy.publicFeed(area)).toMatchObject({
      status: "rate_limited",
      stale: true,
      retryAfter: 12,
      aircraft: [{ hex: "abc123" }],
    });
    expect(await proxy.publicFeed(otherArea)).toMatchObject({
      status: "rate_limited",
      available: false,
    });
    expect(await proxy.publicFeed(area)).toMatchObject({
      status: "rate_limited",
      cache: "cooldown",
      stale: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(
      Response.json({ aircraft: [{ hex: "def456" }] }),
    );
    expect((await proxy.localFeed("http://receiver/feed")).status).toBe("ok");
    vi.setSystemTime(Date.now() + 12001);
    fetcher.mockResolvedValueOnce(Response.json({ ac: [] }));
    expect((await proxy.publicFeed(area)).status).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it.each([
    ["2", 2000],
    ["Thu, 01 Jan 2026 00:00:45 GMT", 45000],
    ["invalid", 30000],
    [null, 30000],
  ] as const)(
    "honors Retry-After %s across all public query keys",
    async (retry, delay) => {
      const proxy = new FeedProxy(fetcher);
      fetcher.mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: retry ? { "Retry-After": retry } : {},
        }),
      );
      await proxy.publicFeed(area);
      vi.setSystemTime(Date.now() + delay - 1);
      expect((await proxy.publicFeed(otherArea)).status).toBe("rate_limited");
      expect(fetcher).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 1);
      fetcher.mockResolvedValueOnce(Response.json({ ac: [] }));
      expect((await proxy.publicFeed(otherArea)).status).toBe("ok");
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("coalesces failures, briefly caches them and recovers after expiry", async () => {
    fetcher.mockRejectedValue(new Error("offline"));
    const proxy = new FeedProxy(fetcher);
    const results = await Promise.all([
      proxy.publicFeed(area),
      proxy.publicFeed(area),
    ]);
    expect(results.every((result) => result.status === "error")).toBe(true);
    expect((await proxy.publicFeed(area)).cache).toBe("hit");
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 8001);
    fetcher.mockResolvedValueOnce(Response.json({ ac: [] }));
    expect((await proxy.publicFeed(area)).status).toBe("ok");
  });
});
