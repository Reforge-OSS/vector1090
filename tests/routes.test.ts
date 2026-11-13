import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetcher = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", fetcher);
  for (const name of [
    "ALLOW_CLIENT_LOCAL_URL",
    "LOCAL_AIRCRAFT_URL",
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
      "https://api.adsb.lol/v2/point/52/-1/250",
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
  it("forwards rate-limit deadlines and reports upstream failures without caching", async () => {
    fetcher.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "45" } }),
    );
    const limited = await aircraft();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "rate_limited",
      retryAfter: "45",
    });
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect((await aircraft()).status).toBe(502);
    fetcher.mockRejectedValueOnce(new DOMException("timed out", "AbortError"));
    const failed = await aircraft();
    expect(failed.headers.get("Cache-Control")).toBe("no-store");
    expect(await failed.json()).toEqual({ error: "upstream_timeout" });
  });
});

describe("receiver configuration", () => {
  it("exposes policy flags without disclosing the receiver address", async () => {
    vi.stubEnv("LOCAL_AIRCRAFT_URL", "http://private-receiver/feed");
    const { GET } = await import("@/app/api/config/route");
    expect(await (await GET()).json()).toEqual({
      allowClientLocalUrl: false,
      localUrlConfigured: true,
    });
    vi.stubEnv("ALLOW_CLIENT_LOCAL_URL", "true");
    expect(await (await GET()).json()).toEqual({
      allowClientLocalUrl: true,
      localUrlConfigured: true,
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
      expect(await result.json()).toEqual({ photo: null });
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
