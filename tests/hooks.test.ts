// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings, sanitizeSettings } from "@/hooks/useSettings";
import { useAircraftFeed } from "@/hooks/useAircraftFeed";
import { useReceiverConfig } from "@/hooks/useReceiverConfig";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { normalizeAircraft } from "@/lib/normalize";

const sample = normalizeAircraft({
  hex: "abc123",
  lat: 52,
  lon: -1,
  alt_baro: 5000,
})!;
const fetcher = vi.fn<typeof fetch>();
const success = (entries = [sample]) =>
  Response.json({ aircraft: entries, total: entries.length });
const flush = async () => {
  await act(async () => {});
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01"));
  vi.stubGlobal("fetch", fetcher);
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  localStorage.clear();
  fetcher.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("settings", () => {
  it("defaults and clamps invalid settings", () => {
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(
      sanitizeSettings({
        homeLat: 999,
        homeLon: -999,
        radiusNm: 0,
        pollIntervalSec: 1,
      }),
    ).toMatchObject({
      homeLat: 90,
      homeLon: -180,
      radiusNm: 1,
      pollIntervalSec: 5,
    });
    expect(sanitizeSettings({ homeLat: NaN, radiusNm: Infinity }).homeLat).toBe(
      DEFAULT_SETTINGS.homeLat,
    );
    expect(
      sanitizeSettings({ mode: "local", pollIntervalSec: 0 }).pollIntervalSec,
    ).toBe(1);
  });
  it("loads persisted settings, preserves explicit intervals and saves changes", () => {
    localStorage.setItem(
      "vector1090:settings",
      JSON.stringify({ homeLat: 50 }),
    );
    const { result } = renderHook(useSettings);
    expect(result.current.settings.homeLat).toBe(50);
    act(() => result.current.setSettings({ mode: "local" }));
    expect(result.current.settings.pollIntervalSec).toBe(2);
    act(() =>
      result.current.setSettings({ mode: "public", pollIntervalSec: 17 }),
    );
    expect(result.current.settings.pollIntervalSec).toBe(17);
    expect(
      JSON.parse(localStorage.getItem("vector1090:settings")!).pollIntervalSec,
    ).toBe(17);
  });
  it("ignores corrupt persisted settings", () => {
    localStorage.setItem("vector1090:settings", "{broken");
    expect(renderHook(useSettings).result.current.settings).toEqual(
      DEFAULT_SETTINGS,
    );
  });
  it("supports hybrid defaults/minimums and persisted viewport opt-out", () => {
    expect(
      sanitizeSettings({
        mode: "hybrid",
        pollIntervalSec: 1,
        trackViewport: false,
      }),
    ).toMatchObject({
      mode: "hybrid",
      pollIntervalSec: 5,
      trackViewport: false,
    });
    expect(sanitizeSettings({}).trackViewport).toBe(true);
    const { result } = renderHook(useSettings);
    act(() => result.current.setSettings({ mode: "local" }));
    act(() => result.current.setSettings({ mode: "hybrid" }));
    expect(result.current.settings.pollIntervalSec).toBe(10);
    act(() =>
      result.current.setSettings({ mode: "public", pollIntervalSec: 18 }),
    );
    expect(result.current.settings.pollIntervalSec).toBe(18);
  });
});

describe("aircraft feed", () => {
  function setup(settings = DEFAULT_SETTINGS) {
    return renderHook(
      ({ settings, paused }: { settings: Settings; paused: boolean }) =>
        useAircraftFeed(settings, paused, true),
      { initialProps: { settings, paused: false } },
    );
  }
  it("polls, appends changed positions and accepts an empty feed", async () => {
    fetcher.mockImplementation(async () => success());
    const { result } = setup();
    await flush();
    expect(result.current.status).toBe("online");
    expect(result.current.aircraft).toEqual([sample]);
    expect(result.current.trailsRef.current.get(sample.hex)).toHaveLength(1);
    expect(result.current.historyRef.current.get(sample.hex)).toHaveLength(1);
    await advance(10000);
    expect(result.current.trailsRef.current.get(sample.hex)).toHaveLength(1);
    expect(result.current.historyRef.current.get(sample.hex)).toHaveLength(2);
    fetcher.mockResolvedValueOnce(success([{ ...sample, lon: 0 }]));
    await advance(10000);
    expect(result.current.trailsRef.current.get(sample.hex)).toHaveLength(2);
    fetcher.mockImplementation(async () => success([]));
    await advance(310000);
    expect(result.current.aircraft).toEqual([]);
    expect(result.current.trailsRef.current.size).toBe(0);
    expect(result.current.historyRef.current.size).toBe(0);
  });
  it("retains data across failures and pauses but clears it on source changes", async () => {
    fetcher.mockImplementation(async () => success());
    const { result, rerender } = setup();
    await flush();
    fetcher.mockRejectedValue(new Error("offline"));
    await advance(10000);
    expect(result.current.status).toBe("error");
    expect(result.current.aircraft).toEqual([sample]);
    rerender({ settings: DEFAULT_SETTINGS, paused: true });
    expect(result.current.aircraft).toEqual([sample]);
    const local: Settings = { ...DEFAULT_SETTINGS, mode: "local" };
    rerender({ settings: local, paused: true });
    expect(result.current.aircraft).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.lastUpdate).toBeNull();
    expect(result.current.trailsRef.current.size).toBe(0);
    fetcher.mockImplementation(async () => success());
    rerender({ settings: local, paused: false });
    await flush();
    expect(result.current.aircraft).toHaveLength(1);
    rerender({
      settings: { ...local, localUrl: "http://other/feed" },
      paused: true,
    });
    expect(result.current.aircraft).toEqual([]);
  });
  it("keeps a 429 deadline across pause and visibility changes, not across sources", async () => {
    fetcher.mockImplementation(
      async () =>
        new Response(JSON.stringify({ retryAfter: 2 }), { status: 429 }),
    );
    const { result, rerender } = setup();
    await flush();
    expect(result.current.status).toBe("rate-limited");
    rerender({ settings: DEFAULT_SETTINGS, paused: true });
    rerender({ settings: DEFAULT_SETTINGS, paused: false });
    await flush();
    for (const hidden of [true, false]) {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: hidden,
      });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    }
    await advance(29999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    rerender({
      settings: { ...DEFAULT_SETTINGS, mode: "local" },
      paused: false,
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("backs off from 2 seconds to a 60-second cap, then recovers", async () => {
    fetcher.mockRejectedValue(new Error("offline"));
    const { result } = setup();
    await flush();
    for (const delay of [2000, 4000, 8000, 16000, 32000, 60000]) {
      const calls = fetcher.mock.calls.length;
      await advance(delay - 1);
      expect(fetcher).toHaveBeenCalledTimes(calls);
      await advance(1);
      expect(fetcher).toHaveBeenCalledTimes(calls + 1);
    }
    fetcher.mockImplementation(async () => success());
    await advance(60000);
    expect(result.current.status).toBe("online");
  });
  it("does not overlap requests or accept a late old-source response", async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const { result, rerender, unmount } = setup();
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender({ settings: { ...DEFAULT_SETTINGS, homeLat: 50 }, paused: true });
    await act(async () => resolve(success()));
    expect(result.current.aircraft).toEqual([]);
    unmount();
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "only sends client URLs when policy allows (%s)",
    async (allowed) => {
      fetcher.mockImplementation(async () => success([]));
      renderHook(() =>
        useAircraftFeed({ ...DEFAULT_SETTINGS, mode: "local" }, false, allowed),
      );
      await flush();
      const url = new URL(String(fetcher.mock.calls[0][0]), "http://localhost");
      expect(url.searchParams.get("url")).toBe(
        allowed ? DEFAULT_SETTINGS.localUrl : null,
      );
    },
  );
});

describe("receiver policy", () => {
  it("fails closed and updates from server configuration", async () => {
    fetcher.mockResolvedValueOnce(
      Response.json({
        allowClientLocalUrl: true,
        localUrlConfigured: true,
        localReceiverConfigured: true,
      }),
    );
    const { result } = renderHook(useReceiverConfig);
    expect(result.current.allowClientLocalUrl).toBe(false);
    await flush();
    expect(result.current).toEqual({
      allowClientLocalUrl: true,
      localUrlConfigured: true,
      localReceiverConfigured: true,
    });
  });
  it("stays locked when configuration is unavailable", async () => {
    fetcher.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(useReceiverConfig);
    await flush();
    expect(result.current.allowClientLocalUrl).toBe(false);
  });
});
