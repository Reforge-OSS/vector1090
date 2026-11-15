// @vitest-environment jsdom
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PhotoCarousel from "@/components/PhotoCarousel";
import AircraftDetails from "@/components/AircraftDetails";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useCallsignRoute } from "@/hooks/useAircraftMetadata";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { normalizeAircraft } from "@/lib/normalize";
import { filterAircraft } from "@/lib/filters";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    onError,
  }: {
    src: string;
    alt: string;
    onError: () => void;
  }) => React.createElement("img", { src, alt, onError }),
}));
const fetcher = vi.fn<typeof fetch>();
const flush = async () => {
  await act(async () => {});
};
beforeEach(() => {
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  localStorage.clear();
});
afterEach(cleanup);
it("persists normalized watchlist entries and applies the watchlist filter with search", () => {
  localStorage.setItem(
    "vector1090:watchlist",
    JSON.stringify(["ABC123", "invalid"]),
  );
  const { result, unmount } = renderHook(useWatchlist);
  expect(result.current.watchlist.has("abc123")).toBe(true);
  act(() => result.current.toggleWatch("DEF456"));
  expect(JSON.parse(localStorage.getItem("vector1090:watchlist")!)).toEqual([
    "abc123",
    "def456",
  ]);
  const aircraft = [
    normalizeAircraft({ hex: "abc123", flight: "BAW117" })!,
    normalizeAircraft({ hex: "000001", flight: "BAW118" })!,
  ];
  expect(
    filterAircraft(
      aircraft,
      "BAW",
      "watchlist",
      DEFAULT_SETTINGS,
      result.current.watchlist,
    ),
  ).toEqual([aircraft[0]]);
  expect(
    filterAircraft(
      aircraft,
      "unknown",
      "watchlist",
      DEFAULT_SETTINGS,
      result.current.watchlist,
    ),
  ).toEqual([]);
  act(() => result.current.toggleWatch("ABC123"));
  unmount();
  expect(renderHook(useWatchlist).result.current.watchlist).toEqual(
    new Set(["def456"]),
  );
});
it("ignores corrupt watchlist storage", () => {
  localStorage.setItem("vector1090:watchlist", "{bad");
  expect(renderHook(useWatchlist).result.current.watchlist.size).toBe(0);
});
it("shows all photos with wraparound arrows, dots and per-photo credits", async () => {
  fetcher.mockResolvedValueOnce(
    Response.json({
      photos: [
        {
          thumbnail: "/one.jpg",
          photographer: "One",
          link: "https://example.com/one",
        },
        {
          thumbnail: "/two.jpg",
          photographer: "Two",
          link: "https://example.com/two",
        },
      ],
    }),
  );
  render(React.createElement(PhotoCarousel, { hex: "a11111" }));
  await flush();
  expect(screen.getByRole("img").getAttribute("src")).toBe("/one.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
  expect(screen.getByRole("img").getAttribute("src")).toBe("/two.jpg");
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "https://example.com/two",
  );
  expect(screen.getByRole("link").textContent).toContain("Two");
  fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
  expect(screen.getByRole("img").getAttribute("src")).toBe("/one.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Photo 2 of 2" }));
  expect(
    screen
      .getByRole("button", { name: "Photo 2 of 2" })
      .getAttribute("aria-current"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Previous photo" }));
  expect(screen.getByRole("img").getAttribute("src")).toBe("/one.jpg");
});
it.each(["empty", "error"])(
  "shows a placeholder for %s photo results",
  async (kind) => {
    if (kind === "empty")
      fetcher.mockResolvedValueOnce(Response.json({ photos: [] }));
    else fetcher.mockRejectedValueOnce(new Error("offline"));
    render(
      React.createElement(PhotoCarousel, {
        hex: kind === "empty" ? "a22222" : "a33333",
      }),
    );
    await flush();
    expect(screen.getByText("No photo available")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Next photo" })).toBeNull();
  },
);
it("hides null extended rows while keeping zero values and provides a quiet empty state", async () => {
  fetcher.mockResolvedValue(Response.json({ airframe: null }));
  const { rerender } = render(
    React.createElement(AircraftDetails, {
      hex: "a44444",
      aircraft: normalizeAircraft({ hex: "a44444" })!,
      route: null,
      history: [],
      settings: DEFAULT_SETTINGS,
    }),
  );
  await flush();
  expect(screen.getByText("No extended data")).toBeDefined();
  rerender(
    React.createElement(AircraftDetails, {
      hex: "a44444",
      aircraft: normalizeAircraft({ hex: "a44444", roll: 0, mach: 0.8 })!,
      route: null,
      history: [],
      settings: DEFAULT_SETTINGS,
    }),
  );
  expect(screen.getByText("0.0°")).toBeDefined();
  expect(screen.queryByText("IAS")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(screen.getAllByText("Collecting session history")).toHaveLength(2);
});
it("makes callsign routes reusable, cached, and clears data on an invalid callsign", async () => {
  const route = {
    callsign: "BAW117",
    origin: { icao: "EGLL" },
    destination: { icao: "KJFK" },
  };
  fetcher.mockResolvedValueOnce(Response.json({ route }));
  const { result, rerender, unmount } = renderHook(
    ({ callsign }) => useCallsignRoute(callsign),
    { initialProps: { callsign: "BAW117" } },
  );
  await flush();
  expect(result.current.data).toEqual(route);
  rerender({ callsign: "../invalid" });
  expect(result.current.data).toBeNull();
  unmount();
  renderHook(() => useCallsignRoute("baw117"));
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
