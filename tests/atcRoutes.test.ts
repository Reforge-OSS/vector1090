import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fetcher = vi.fn<typeof fetch>();
const status = {
  icestats: {
    source: { listenurl: "http://receiver/tower", server_name: "Tower" },
  },
};
const pages = [
  {
    ident: "ltac",
    name: "LTAC/ESB - Ankara Airport",
    category: "aerodrome",
    channels: [{ url: "TOWER", type: "aerodrome", freq: "118.100 MHz" }],
  },
];
beforeEach(() => {
  vi.resetModules();
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
  delete (globalThis as unknown as Record<symbol, unknown>)[
    Symbol.for("vector1090.atc")
  ];
  for (const key of [
    "ATC_ICECAST_URL",
    "ATC_ICECAST_LABELS",
    "ATC_ICECAST_AIRPORT",
    "IBONAV_ATC_TOKEN",
  ])
    vi.stubEnv(key, "");
});
afterEach(() => vi.useRealTimers());
describe("ATC channels API", () => {
  it("returns an honest empty state without making requests", async () => {
    const { GET } = await import("@/app/api/atc/channels/route");
    expect(await (await GET()).json()).toEqual({
      channels: [],
      configured: false,
      providers: { icecast: "disabled", ibonav: "disabled" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("coalesces concurrent requests and caches status for at least a minute", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ATC_ICECAST_URL", "http://receiver");
    fetcher.mockImplementation(async () => Response.json(status));
    const { GET } = await import("@/app/api/atc/channels/route");
    const [first, second] = await Promise.all([GET(), GET()]);
    expect((await first.json()).channels).toHaveLength(1);
    expect((await second.json()).channels).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(59999);
    await GET();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await GET();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("keeps secrets and upstream addresses out of channels and config", async () => {
    vi.stubEnv(
      "ATC_ICECAST_URL",
      "http://owner:private-password@receiver:8000",
    );
    vi.stubEnv("IBONAV_ATC_TOKEN", "private-token");
    fetcher.mockImplementation(async (input) =>
      String(input).includes("channels.json")
        ? Response.json(pages)
        : Response.json(status),
    );
    const { GET } = await import("@/app/api/atc/channels/route");
    const text = await (await GET()).text();
    expect(text).not.toMatch(/private-password|private-token|receiver:8000/);
    const config = await (
      await (await import("@/app/api/config/route")).GET()
    ).text();
    expect(config).not.toMatch(/private-password|private-token|ATC/);
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url).includes("access_token=private-token") &&
          options?.redirect === "error",
      ),
    ).toBe(true);
    expect(
      fetcher.mock.calls.some(
        ([url, options]) =>
          String(url) === "http://receiver:8000/status-json.xsl" &&
          (
            options?.headers as Record<string, string>
          ).Authorization?.startsWith("Basic "),
      ),
    ).toBe(true);
  });
  it("honors Retry-After across list/status/stream calls and preserves the healthy receiver", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ATC_ICECAST_URL", "http://receiver");
    vi.stubEnv("IBONAV_ATC_TOKEN", "test-token");
    fetcher.mockImplementation(async (input) =>
      String(input).includes("receiver")
        ? Response.json(status)
        : String(input).includes("channels.json")
          ? Response.json(pages)
          : new Response(null, {
              status: 429,
              headers: { "Retry-After": "120" },
            }),
    );
    const { GET } = await import("@/app/api/atc/channels/route");
    const first = await GET(),
      data = await first.json();
    expect(first.status).toBe(200);
    expect(data).toMatchObject({
      retryAfter: 120,
      providers: { icecast: "ok", ibonav: "rate_limited" },
    });
    expect(
      data.channels.find((c: { provider: string }) => c.provider === "ibonav")
        .online,
    ).toBe(false);
    await GET();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const stream = await (
      await import("@/app/api/atc/stream/route")
    ).GET(new Request("http://app/api/atc/stream?id=ibonav%3A%2FTOWER"));
    expect(stream.status).toBe(429);
    expect(stream.headers.get("Retry-After")).toBe("120");
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60001);
    await GET();
    expect(
      fetcher.mock.calls.filter(
        ([url]) =>
          String(url).includes("ibosoft") || String(url).includes("ibonav"),
      ),
    ).toHaveLength(2);
  });
  it("returns 429 when the only configured provider is cooling down", async () => {
    vi.stubEnv("IBONAV_ATC_TOKEN", "test-token");
    fetcher.mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": new Date(Date.now() + 90000).toUTCString() },
      }),
    );
    const response = await (await import("@/app/api/atc/channels/route")).GET();
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(
      89,
    );
  });
  it("caches upstream failures without echoing error bodies", async () => {
    vi.stubEnv("ATC_ICECAST_URL", "http://receiver");
    fetcher.mockResolvedValue(
      new Response("private-upstream-error", { status: 503 }),
    );
    const { GET } = await import("@/app/api/atc/channels/route");
    expect(await (await GET()).json()).toMatchObject({
      channels: [],
      configured: true,
      providers: { icecast: "error" },
    });
    await GET();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe("stream proxy", () => {
  it("streams chunks without buffering and cancels upstream on disconnect", async () => {
    vi.stubEnv("ATC_ICECAST_URL", "http://receiver");
    const cancelled = vi.fn();
    fetcher.mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
          },
          cancel: cancelled,
        }),
        { headers: { "Content-Type": "audio/mpeg", "Set-Cookie": "private" } },
      ),
    );
    const response = await (
      await import("@/app/api/atc/stream/route")
    ).GET(new Request("http://app/api/atc/stream?id=icecast%3A%2Ftower"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    await reader.cancel();
    expect(cancelled).toHaveBeenCalled();
    expect((fetcher.mock.calls[1][1]?.signal as AbortSignal).aborted).toBe(
      true,
    );
  });
  it("does not accept arbitrary client URLs or unsafe IDs", async () => {
    vi.stubEnv("ATC_ICECAST_URL", "http://receiver");
    fetcher.mockResolvedValue(Response.json(status));
    const response = await (
      await import("@/app/api/atc/stream/route")
    ).GET(
      new Request(
        "http://app/api/atc/stream?id=icecast%3A%2F..%2Fadmin&url=http://evil",
      ),
    );
    expect(response.status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["text/html", 200],
    ["audio/mpeg", 401],
  ])(
    "rejects non-audio/error responses: %s %i",
    async (contentType, httpStatus) => {
      vi.stubEnv("ATC_ICECAST_URL", "http://receiver");
      fetcher
        .mockResolvedValueOnce(Response.json(status))
        .mockResolvedValueOnce(
          new Response("private", {
            status: httpStatus,
            headers: { "Content-Type": contentType },
          }),
        );
      const response = await (
        await import("@/app/api/atc/stream/route")
      ).GET(new Request("http://app/api/atc/stream?id=icecast%3A%2Ftower"));
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("private");
    },
  );
  it("contains connection errors and invalid receiver configuration", async () => {
    vi.stubEnv("ATC_ICECAST_URL", "not a URL");
    const data = await (
      await (await import("@/app/api/atc/channels/route")).GET()
    ).json();
    expect(data.providers.icecast).toBe("error");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
