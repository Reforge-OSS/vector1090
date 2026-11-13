// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import React from "react";
import TopHud from "@/components/TopHud";
import EmergencyAlerts from "@/components/EmergencyAlerts";
import { useMapState } from "@/hooks/useMapState";
import { useReceiverRange } from "@/hooks/useReceiverRange";
import { useWeatherRadar } from "@/hooks/useWeatherRadar";
import { useSelectedAircraft } from "@/hooks/useSelectedAircraft";
import { useSettings, sanitizeSettings } from "@/hooks/useSettings";
import { DEFAULT_SETTINGS, type MapViewport } from "@/lib/types";
import { normalizeAircraft } from "@/lib/normalize";
const ac = normalizeAircraft(
  {
    hex: "abc123",
    flight: "BAW117",
    lat: 52.9,
    lon: -1.3,
    seen: 0,
    squawk: "7700",
  },
  "local",
)!;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("retains the last selected observation across viewport changes but not source or selection changes", () => {
  const { result, rerender } = renderHook(
    ({
      hex,
      aircraft,
      source,
    }: {
      hex: string | null;
      aircraft: typeof ac | undefined;
      source: string;
    }) => useSelectedAircraft(hex, aircraft, 1000, source),
    {
      initialProps: {
        hex: ac.hex as string | null,
        aircraft: ac as typeof ac | undefined,
        source: "public",
      },
    },
  );
  rerender({ hex: ac.hex, aircraft: undefined, source: "public" });
  expect(result.current?.aircraft).toEqual(ac);
  expect(result.current?.lastUpdate).toBe(1000);
  rerender({ hex: "ffffff", aircraft: undefined, source: "public" });
  expect(result.current).toBeNull();
  rerender({ hex: ac.hex, aircraft: ac, source: "local" });
  rerender({ hex: ac.hex, aircraft: undefined, source: "local" });
  expect(result.current).toBeNull();
});
it("restores a shared selection before the viewport arrives and throttles URL writes", () => {
  vi.useFakeTimers();
  window.history.replaceState(
    null,
    "",
    "/?hex=ABC123&lat=51.47&lon=-0.46&zoom=6&filter=low&other=kept",
  );
  const { result, rerender } = renderHook(
    ({ viewport }: { viewport: MapViewport | null }) => useMapState(viewport),
    { initialProps: { viewport: null as MapViewport | null } },
  );
  expect(result.current.selectedHex).toBe("abc123");
  expect(result.current.filter).toBe("low");
  expect(result.current.initialCamera).toEqual({
    lat: 51.47,
    lon: -0.46,
    zoom: 6,
  });
  const replace = vi.spyOn(window.history, "replaceState");
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(replace).not.toHaveBeenCalled();
  rerender({
    viewport: {
      center: { lat: 40.64123, lon: -73.78123 },
      zoom: 7.123,
      bounds: { west: -74, east: -73, south: 40, north: 41 },
      radiusNm: 80,
    },
  });
  act(() => {
    result.current.setSelectedHex(null);
    result.current.setFilter("military");
    vi.advanceTimersByTime(499);
  });
  expect(replace).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(window.location.search).toBe(
    "?other=kept&lat=40.6412&lon=-73.7812&zoom=7.12&filter=military",
  );
  expect(replace).toHaveBeenCalledTimes(1);
});
it("persists layers, sanitizes corrupt toggles and supports functional updates", () => {
  expect(
    sanitizeSettings({
      layers: {
        rangeRings: "bad",
        allTrails: true,
      } as unknown as typeof DEFAULT_SETTINGS.layers,
    }).layers,
  ).toEqual({ ...DEFAULT_SETTINGS.layers, allTrails: true });
  const { result } = renderHook(() => useSettings());
  act(() => {
    result.current.setSettings((previous) => ({
      layers: { ...previous.layers, allTrails: true, terminator: true },
    }));
  });
  expect(
    JSON.parse(localStorage.getItem("vector1090:settings")!).layers.allTrails,
  ).toBe(true);
  expect(result.current.settings.layers.terminator).toBe(true);
});
it("keeps receiver history isolated by home, ignores public data and resets", () => {
  const key = "vector1090:receiver-range:52.8311,-1.3281";
  const { result, rerender } = renderHook(
    ({ lat }: { lat: number }) =>
      useReceiverRange({ lat, lon: -1.3281 }, [ac], true),
    { initialProps: { lat: 52.8311 } },
  );
  expect(result.current.sectors.some((value) => value > 0)).toBe(true);
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(
    result.current.sectors,
  );
  act(() => result.current.reset());
  expect(result.current.sectors).toEqual(Array(72).fill(0));
  rerender({ lat: 53 });
  expect(
    localStorage.getItem("vector1090:receiver-range:53.0000,-1.3281"),
  ).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(Array(72).fill(0));
});
it("recovers weather failures, coalesces toggles and refreshes at ten minutes", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            host: "https://tilecache.rainviewer.com",
            radar: { past: [{ time: 1, path: "/v2/radar/frame" }] },
          }),
        ),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(
    ({ enabled }) => useWeatherRadar(enabled),
    { initialProps: { enabled: false } },
  );
  expect(fetcher).not.toHaveBeenCalled();
  rerender({ enabled: true });
  await act(async () => {});
  expect(result.current.error).toBe(true);
  rerender({ enabled: false });
  rerender({ enabled: true });
  await act(async () => {});
  expect(result.current.tiles).toContain("/v2/radar/frame");
  expect(result.current.error).toBe(false);
  rerender({ enabled: false });
  rerender({ enabled: true });
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600_000);
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("selects emergencies and scopes dismissal to the hex+squawk pair, hiding stale data", () => {
  const onSelect = vi.fn(),
    onVisible = vi.fn();
  const props = {
    aircraft: [ac],
    lastUpdate: Date.now(),
    stale: false,
    onSelect,
    onVisible,
  };
  const { rerender } = render(React.createElement(EmergencyAlerts, props));
  fireEvent.click(screen.getByText("BAW117"));
  expect(onSelect).toHaveBeenCalledWith("abc123");
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss emergency abc123 7700" }),
  );
  expect(screen.queryByLabelText("Emergency alerts")).toBeNull();
  rerender(
    React.createElement(EmergencyAlerts, {
      ...props,
      aircraft: [{ ...ac, squawk: "7600" }],
    }),
  );
  expect(screen.getByText("7600")).toBeTruthy();
  rerender(React.createElement(EmergencyAlerts, { ...props, stale: true }));
  expect(screen.queryByLabelText("Emergency alerts")).toBeNull();
  rerender(
    React.createElement(EmergencyAlerts, {
      ...props,
      lastUpdate: Date.now() - 61_000,
    }),
  );
  expect(screen.queryByLabelText("Emergency alerts")).toBeNull();
});
it("removes the feed chip, offers layers and overhead selection, and closes on Escape", () => {
  const onLayer = vi.fn(),
    onSelect = vi.fn();
  render(
    React.createElement(TopHud, {
      mode: "public",
      status: "online",
      lastUpdate: Date.now(),
      shown: 1,
      total: 1,
      filtered: false,
      paused: false,
      onPause: vi.fn(),
      onSettings: vi.fn(),
      onSidebar: vi.fn(),
      layers: DEFAULT_SETTINGS.layers,
      onLayer,
      onResetRange: vi.fn(),
      overhead: [ac],
      onSelect,
    }),
  );
  expect(screen.queryByText("Public API")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Map layers" }));
  const receiver = screen.getByRole("checkbox", {
    name: "Receiver range",
  }) as HTMLInputElement;
  expect(receiver.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "All trails" }));
  expect(onLayer).toHaveBeenCalledWith("allTrails", true);
  fireEvent.keyDown(receiver, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Map layers" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Overhead/ }));
  fireEvent.click(screen.getByRole("button", { name: /BAW117/ }));
  expect(onSelect).toHaveBeenCalledWith("abc123");
});
