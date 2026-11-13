import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", fetcher);
  for (const name of [
    "ALLOW_CLIENT_LOCAL_URL",
    "LOCAL_AIRCRAFT_URL",
    "LOCAL_RECEIVER_URL",
    "FEED_MODE",
    "ADSB_API_BASE",
    "ADSB_API_KEY",
    "HOME_LAT",
    "HOME_LON",
    "HOME_RADIUS_NM",
    "PHOTO_USER_AGENT",
  ])
    vi.stubEnv(name, undefined);
  fetcher.mockReset();
});
afterEach(() => vi.useRealTimers());

async function aircraft(query = "") {
  const { GET } = await import("@/app/api/aircraft/route");
  return GET(new NextRequest("http://localhost/api/aircraft" + query));
}

describe("aircraft route", () => {
  it.each([undefined, "false", "TRUE"])(
    "ignores client URLs unless explicitly enabled (%s)",
    async (policy) => {
      vi.stubEnv("ALLOW_CLIENT_LOCAL_URL", policy);
      vi.stubEnv("LOCAL_AIRCRAFT_URL", "http://receiver/data/aircraft.json");
      fetcher.mockResolvedValue(
        Response.json({ aircraft: [{ hex: "ABC123", dbFlags: 3 }] }),
      );
      const result = await aircraft("?mode=local&url=http://untrusted/private");
      expect(String(fetcher.mock.calls[0][0])).toBe(
        "http://receiver/data/aircraft.json",
      );
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      expect(await result.json()).toMatchObject({
        total: 1,
        mode: "local",
        aircraft: [{ hex: "abc123", isMilitary: true, isInteresting: true }],
      });
    },
  );
  it("supports explicit client URL opt-in and validates schemes", async () => {
    vi.stubEnv("ALLOW_CLIENT_LOCAL_URL", "true");
    fetcher.mockResolvedValue(Response.json({ aircraft: [] }));
    expect((await aircraft("?mode=local&url=http://custom/feed")).status).toBe(
      200,
    );
    expect(String(fetcher.mock.calls[0][0])).toBe("http://custom/feed");
    expect((await aircraft("?mode=local&url=ftp://custom/feed")).status).toBe(
      400,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uses the server default when no local URL is configured", async () => {
    fetcher.mockResolvedValue(Response.json({ aircraft: [] }));
    await aircraft("?mode=local&url=ftp://ignored");
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "http://localhost:8080/data/aircraft.json",
    );
  });
  it("clamps public radius and identifies requests without exposing the API key", async () => {
    vi.stubEnv("ADSB_API_KEY", "test-key");
    fetcher.mockResolvedValue(Response.json({ ac: [] }));
    const result = await aircraft("?lat=52&lon=-1&radius=999");
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://api.adsb.lol/v2/lat/52/lon/-1/dist/250",
    );
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      "User-Agent":
        "vector1090/1.0 (+https://github.com/Reforge-OSS/vector1090)",
      "x-api-key": "test-key",
    });
    expect(await result.json()).toMatchObject({ aircraft: [], total: 0 });
  });
  it.each(["?mode=unknown", "?lat=91", "?lon=-181"])(
    "rejects invalid input: %s",
    async (query) => {
      expect((await aircraft(query)).status).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("forwards rate limits and skips every other public query during cooldown", async () => {
    fetcher.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "45" } }),
    );
    const limited = await aircraft();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({
      error: "rate_limited",
      retryAfter: 45,
      sources: { public: "rate_limited" },
    });
    const skipped = await aircraft("?scope=global");
    expect(skipped.status).toBe(429);
    expect(skipped.headers.get("X-Cache")).toBe("cooldown");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["http", "timeout"])(
    "reports %s failures with no browser caching",
    async (failure) => {
      if (failure === "http")
        fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
      else
        fetcher.mockRejectedValueOnce(
          new DOMException("timed out", "AbortError"),
        );
      const failed = await aircraft();
      expect(failed.status).toBe(502);
      expect(failed.headers.get("Cache-Control")).toBe("no-store");
      expect(await failed.json()).toMatchObject({
        error: failure === "http" ? "upstream_503" : "upstream_timeout",
        sources: { public: "error" },
      });
    },
  );
  it("returns cache headers for identical normalized area queries", async () => {
    fetcher.mockImplementation(async () => Response.json({ ac: [] }));
    expect(
      (await aircraft("?lat=40.64&lon=-73.78&radius=80")).headers.get(
        "X-Cache",
      ),
    ).toBe("miss");
    expect(
      (await aircraft("?lat=40.66&lon=-73.79&radius=90")).headers.get(
        "X-Cache",
      ),
    ).toBe("hit");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("prefers the primary receiver env name over the legacy alias", async () => {
    vi.stubEnv("LOCAL_RECEIVER_URL", "http://primary/feed");
    vi.stubEnv("LOCAL_AIRCRAFT_URL", "http://legacy/feed");
    fetcher.mockResolvedValueOnce(Response.json({ aircraft: [] }));
    await aircraft("?mode=local");
    expect(String(fetcher.mock.calls[0][0])).toBe("http://primary/feed");
  });
  it("merges hybrid feeds by hex, with local telemetry and no client URL override", async () => {
    vi.stubEnv("LOCAL_RECEIVER_URL", "http://receiver/feed");
    vi.stubEnv("ALLOW_CLIENT_LOCAL_URL", "true");
    vi.stubEnv("FEED_MODE", "HYBRID");
    fetcher.mockImplementation(async (url) =>
      String(url) === "http://receiver/feed"
        ? Response.json({
            aircraft: [
              { hex: "abc123", flight: "LOCAL", alt_baro: 1234 },
              { hex: "fed987" },
            ],
          })
        : Response.json({
            ac: [
              { hex: "abc123", flight: "PUBLIC", alt_baro: 30000 },
              { hex: "def456" },
            ],
          }),
    );
    const result = await aircraft("?url=http://ignored/feed");
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({
      mode: "hybrid",
      total: 3,
      sources: { local: "ok", public: "ok" },
    });
    expect(
      body.aircraft.find((ac: { hex: string }) => ac.hex === "abc123"),
    ).toMatchObject({ flight: "LOCAL", alt_baro: 1234, feedSource: "local" });
    expect(
      body.aircraft.find((ac: { hex: string }) => ac.hex === "def456")
        .feedSource,
    ).toBe("public");
    expect(fetcher.mock.calls.map(([url]) => String(url))).not.toContain(
      "http://ignored/feed",
    );
  });
  it.each(["local", "public", "rate_limited"])(
    "keeps the working hybrid feed when %s fails",
    async (failure) => {
      vi.stubEnv("LOCAL_RECEIVER_URL", "http://receiver/feed");
      fetcher.mockImplementation(async (url) => {
        const local = String(url) === "http://receiver/feed";
        if ((failure === "local" && local) || (failure === "public" && !local))
          throw new Error("offline");
        if (failure === "rate_limited" && !local)
          return new Response(null, {
            status: 429,
            headers: { "Retry-After": "60" },
          });
        return Response.json({
          aircraft: [{ hex: local ? "abc123" : "def456" }],
        });
      });
      const response = await aircraft("?mode=hybrid");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.aircraft).toHaveLength(1);
      expect(body.sources).toEqual({
        local: failure === "local" ? "error" : "ok",
        public:
          failure === "local"
            ? "ok"
            : failure === "rate_limited"
              ? "rate_limited"
              : "error",
      });
      if (failure === "rate_limited") expect(body.retryAfter).toBe(60);
    },
  );
  it("aligns cached public and fresh local ages to the response timestamp", async () => {
    vi.useFakeTimers();
    vi.stubEnv("LOCAL_RECEIVER_URL", "http://receiver/feed");
    const now = Date.now() / 1000;
    fetcher.mockImplementation(async (url) =>
      String(url) === "http://receiver/feed"
        ? Response.json({
            now: now + 4,
            aircraft: [{ hex: "abc123", seen: 2 }],
          })
        : Response.json({ now, ac: [{ hex: "def456", seen: 3 }] }),
    );
    await aircraft();
    const response = await (await aircraft("?mode=hybrid")).json();
    expect(response.now).toBe(now + 4);
    expect(
      response.aircraft.find((ac: { hex: string }) => ac.hex === "def456").seen,
    ).toBe(7);
    expect(
      response.aircraft.find((ac: { hex: string }) => ac.hex === "abc123").seen,
    ).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("disables an unconfigured hybrid receiver and still serves public aircraft", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ac: [] }));
    expect(await (await aircraft("?mode=hybrid")).json()).toMatchObject({
      sources: { local: "disabled", public: "ok" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("receiver configuration", () => {
  it("exposes policy flags without disclosing the receiver address", async () => {
    vi.stubEnv("LOCAL_AIRCRAFT_URL", "http://private-receiver/feed");
    const { GET } = await import("@/app/api/config/route");
    expect(await (await GET()).json()).toEqual({
      allowClientLocalUrl: false,
      localUrlConfigured: true,
      localReceiverConfigured: true,
    });
    vi.stubEnv("ALLOW_CLIENT_LOCAL_URL", "true");
    expect(await (await GET()).json()).toEqual({
      allowClientLocalUrl: true,
      localUrlConfigured: true,
      localReceiverConfigured: true,
    });
  });
});

describe("photo route", () => {
  const photo = {
    thumbnail_large: { src: "https://t.plnspttrs.net/large.jpg" },
    thumbnail: { src: "https://t.plnspttrs.net/small.jpg" },
    link: "https://www.planespotters.net/photo/1",
    photographer: "Photographer",
  };
  async function request(hex = "abc123") {
    const { GET } = await import("@/app/api/photo/[hex]/route");
    return GET(new Request("http://localhost/api/photo/" + hex), {
      params: { hex },
    });
  }
  it.each([{ photos: [] }, { photos: [photo] }])(
    "caches genuine lookup results for one hour: %j",
    async ({ photos }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01"));
      fetcher.mockImplementation(async () => Response.json({ photos }));
      const first = await request("ABC123");
      expect(first.headers.get("Cache-Control")).toBe("public, max-age=3600");
      const data = await first.json();
      expect(data.photo).toEqual(
        photos.length
          ? {
              thumbnail: photo.thumbnail_large.src,
              large: photo.thumbnail_large.src,
              link: photo.link,
              photographer: photo.photographer,
            }
          : null,
      );
      await request();
      expect(fetcher).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 3_600_001);
      await request();
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["http", "network", "malformed"])(
    "does not cache %s failures",
    async (failure) => {
      if (failure === "network")
        fetcher.mockRejectedValueOnce(new Error("offline"));
      else
        fetcher.mockResolvedValueOnce(
          failure === "http"
            ? new Response(null, { status: 503 })
            : Response.json({}),
        );
      const result = await request();
      expect(result.status).toBe(502);
      expect(result.headers.get("Cache-Control")).toBe("no-store");
      expect(await result.json()).toEqual({ photo: null, photos: [] });
      fetcher.mockResolvedValueOnce(Response.json({ photos: [photo] }));
      expect((await request()).status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("validates identifiers and allows an identifying User-Agent override", async () => {
    expect((await request("../invalid")).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv("PHOTO_USER_AGENT", "receiver-owner/1.0");
    fetcher.mockResolvedValue(Response.json({ photos: [] }));
    await request();
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      "User-Agent": "receiver-owner/1.0",
    });
  });
});

describe("client photo cache", () => {
  it.each([null, { thumbnail: "/photo.jpg" }])(
    "deduplicates and expires successful results: %j",
    async (photo) => {
      vi.useFakeTimers();
      const { loadPhoto } = await import("@/lib/photos");
      fetcher.mockImplementation(async () => Response.json({ photo }));
      expect(
        await Promise.all([loadPhoto("abc123"), loadPhoto("abc123")]),
      ).toEqual([photo, photo]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 3_600_001);
      await loadPhoto("abc123");
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("evicts failures so reselecting retries", async () => {
    const { loadPhoto } = await import("@/lib/photos");
    fetcher
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ photo: null }));
    await expect(loadPhoto("abc123")).rejects.toThrow();
    await expect(loadPhoto("abc123")).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
