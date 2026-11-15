// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAircraftFeed } from "@/hooks/useAircraftFeed";
import { DEFAULT_SETTINGS, type MapViewport } from "@/lib/types";
import { normalizeAircraft } from "@/lib/normalize";

const sample = normalizeAircraft({ hex: "abc123", lat: 52, lon: 0, seen: 0 })!;
const fetcher = vi.fn<typeof fetch>();
const view = (lat = 52, zoom = 6): MapViewport => ({
  center: { lat, lon: 0 },
  zoom,
  radiusNm: 80,
  bounds: { west: -1, east: 1, south: lat - 1, north: lat + 1 },
});
const body = () => ({
  aircraft: [sample],
  total: 1,
  now: Date.now() / 1000,
  sources: { local: "disabled", public: "ok" },
});
const flush = async () => {
  await act(async () => {});
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetcher);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  fetcher.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("waits for the initial viewport instead of making a redundant home request", async () => {
  fetcher.mockImplementation(async () => Response.json(body()));
  const { result, rerender } = renderHook(
    ({ viewport }: { viewport: MapViewport | null }) =>
      useAircraftFeed(DEFAULT_SETTINGS, false, false, viewport),
    { initialProps: { viewport: null as MapViewport | null } },
  );
  await flush();
  expect(fetcher).not.toHaveBeenCalled();
  expect(result.current.status).toBe("connecting");
  rerender({ viewport: view() });
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe("online");
});

it("keeps aircraft and trails while a new viewport response is pending, then replaces the feed", async () => {
  fetcher.mockResolvedValueOnce(Response.json(body()));
  const { result, rerender } = renderHook(
    ({ viewport }) => useAircraftFeed(DEFAULT_SETTINGS, false, false, viewport),
    { initialProps: { viewport: view() } },
  );
  await flush();
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  rerender({ viewport: view(40) });
  expect(result.current.aircraft).toEqual([sample]);
  expect(result.current.trailsRef.current.get(sample.hex)).toHaveLength(1);
  await act(async () =>
    finish(Response.json({ ...body(), aircraft: [{ ...sample, lat: 40 }] })),
  );
  expect(result.current.aircraft[0].lat).toBe(40);
  expect(result.current.trailsRef.current.get(sample.hex)).toHaveLength(2);
});

it("switches to global below zoom 5 and back to area without leaking coordinates", async () => {
  fetcher.mockImplementation(async () => Response.json(body()));
  const { rerender } = renderHook(
    ({ viewport }) => useAircraftFeed(DEFAULT_SETTINGS, false, false, viewport),
    { initialProps: { viewport: view(52, 4) } },
  );
  await flush();
  let query = new URL(String(fetcher.mock.calls[0][0]), "http://localhost")
    .searchParams;
  expect(query.get("scope")).toBe("global");
  expect(query.has("lat")).toBe(false);
  rerender({ viewport: view(40, 5) });
  await flush();
  query = new URL(String(fetcher.mock.calls[1][0]), "http://localhost")
    .searchParams;
  expect(query.get("scope")).toBe("area");
  expect(query.get("lat")).toBe("40");
});

it.each(["local", "fixed"] as const)(
  "ignores viewport movement for %s polling",
  async (kind) => {
    fetcher.mockImplementation(async () => Response.json(body()));
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(kind === "local"
        ? { mode: "local" as const }
        : { trackViewport: false }),
    };
    const { rerender } = renderHook(
      ({ viewport }) => useAircraftFeed(settings, false, false, viewport),
      { initialProps: { viewport: view() } },
    );
    await flush();
    rerender({ viewport: view(40) });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const query = new URL(String(fetcher.mock.calls[0][0]), "http://localhost")
      .searchParams;
    if (kind === "local") expect(query.has("lat")).toBe(false);
    else expect(query.get("lat")).toBe("52.75");
  },
);

it("reports hybrid degradation without postponing local polling to the public deadline", async () => {
  fetcher.mockImplementation(async () =>
    Response.json({
      ...body(),
      retryAfter: 60,
      sources: { local: "ok", public: "rate_limited" },
    }),
  );
  const { result } = renderHook(() =>
    useAircraftFeed({ ...DEFAULT_SETTINGS, mode: "hybrid" }, false),
  );
  await flush();
  expect(result.current.status).toBe("partial");
  expect(result.current.retryAfter).toBe(60);
  expect(result.current.aircraft).toEqual([sample]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe("partial");
});
