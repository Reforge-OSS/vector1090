// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAtcAudio } from "@/hooks/useAtcAudio";
import { useAtcChannels } from "@/hooks/useAtcChannels";
import AtcPicker from "@/components/AtcPicker";
import AtcPlayer from "@/components/AtcPlayer";
import type { AtcChannel } from "@/lib/atc";
const first: AtcChannel = {
  id: "icecast:/main",
  provider: "icecast",
  airportIcao: "EGLL",
  airportIata: "LHR",
  city: "London",
  country: "United Kingdom",
  name: "Main Tower",
  frequency: "118.500 MHz",
  type: "tower",
  streamUrl: "/api/atc/stream?id=icecast%3A%2Fmain",
  online: true,
  latitude: 51.47,
  longitude: -0.46,
};
const backup = {
  ...first,
  id: "ibonav:/backup",
  provider: "ibonav" as const,
  name: "Backup Tower",
  streamUrl: "/api/atc/stream?id=ibonav%3A%2Fbackup",
};
const instances: FakeAudio[] = [];
class FakeAudio {
  preload = "";
  volume = 1;
  src = "";
  currentTime = 0;
  onplaying: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onstalled: (() => void) | null = null;
  onended: (() => void) | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor() {
    instances.push(this);
  }
}
beforeEach(() => {
  instances.length = 0;
  localStorage.clear();
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal(
    "AudioContext",
    class {
      createAnalyser() {
        return {
          fftSize: 64,
          connect: vi.fn(),
          disconnect: vi.fn(),
          getByteFrequencyData: vi.fn(),
        };
      }
      createMediaElementSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("audio playback lifecycle", () => {
  it("cancels a pending backup and clears its note when paused", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAtcAudio([first, backup], 0.6));
    act(() => result.current.select(first));
    act(() => result.current.toggle());
    act(() => instances[0].onerror?.());
    expect(result.current.note).toBe("Trying backup…");
    act(() => result.current.toggle());
    expect(result.current.status).toBe("paused");
    expect(result.current.note).toBe("");
    act(() => vi.advanceTimersByTime(20000));
    expect(instances).toHaveLength(1);
  });
  it("does not preload or autoplay; preserves volume and stops on pause", () => {
    const { result, rerender } = renderHook(
      ({ volume }) => useAtcAudio([first, backup], volume),
      { initialProps: { volume: 0.4 } },
    );
    expect(instances).toHaveLength(0);
    act(() => result.current.select(first));
    act(() => result.current.toggle());
    expect(instances[0]).toMatchObject({
      preload: "none",
      src: first.streamUrl,
      volume: 0.4,
    });
    act(() => instances[0].onplaying?.());
    expect(result.current.status).toBe("playing");
    rerender({ volume: 0.2 });
    expect(instances[0].volume).toBe(0.2);
    act(() => result.current.toggle());
    expect(result.current.status).toBe("paused");
    expect(instances[0].pause).toHaveBeenCalled();
  });
  it.each(["onerror", "onstalled", "onended"] as const)(
    "fails over once after %s and cancels retries on user selection/unmount",
    (event) => {
      vi.useFakeTimers();
      const { result, unmount } = renderHook(() =>
        useAtcAudio([first, backup], 0.6),
      );
      act(() => result.current.select(first));
      act(() => result.current.toggle());
      act(() => instances[0][event]?.());
      expect(result.current.note).toBe("Trying backup…");
      act(() => vi.advanceTimersByTime(1000));
      expect(result.current.current?.id).toBe(backup.id);
      expect(result.current.note).toBe("Switched to backup: Backup Tower");
      act(() => instances[1].onerror?.());
      expect(result.current.note).toBe("No live stream available");
      act(() => result.current.toggle());
      act(() => instances[2].onerror?.());
      unmount();
      act(() => vi.advanceTimersByTime(20000));
      expect(instances).toHaveLength(3);
    },
  );
  it("uses playback clock progress, not signal loudness, and times out after eight seconds", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAtcAudio([first, backup], 0.6));
    act(() => result.current.select(first));
    act(() => result.current.toggle());
    act(() => instances[0].onplaying?.());
    instances[0].currentTime = 4;
    act(() => vi.advanceTimersByTime(500));
    act(() => vi.advanceTimersByTime(7500));
    expect(result.current.status).toBe("playing");
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.note).toBe("Trying backup…");
    act(() => vi.advanceTimersByTime(1000));
    expect(instances).toHaveLength(2);
  });
  it("handles browser gesture denial without hopping between providers", async () => {
    const { result } = renderHook(() => useAtcAudio([first, backup], 0.6));
    act(() => result.current.select(first));
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        play = vi.fn(() =>
          Promise.reject(
            new DOMException("Gesture required", "NotAllowedError"),
          ),
        );
      },
    );
    await act(async () => result.current.toggle());
    expect(result.current.status).toBe("paused");
    expect(result.current.note).toBe("Press play to start audio");
    expect(instances).toHaveLength(1);
  });
  it("allows custom streams without requiring CORS or routing them through the server", () => {
    const custom = {
      ...first,
      id: "custom:test",
      provider: "custom" as const,
      streamUrl: "https://receiver/stream",
    };
    const { result } = renderHook(() => useAtcAudio([custom], 0.6));
    act(() => result.current.select(custom));
    act(() => result.current.toggle());
    expect(instances[0].src).toBe(custom.streamUrl);
    expect(result.current.meterAvailable).toBe(false);
  });
});
it("migrates valid custom URLs, drops legacy prohibited defaults, and persists saved channels", async () => {
  localStorage.setItem(
    "vector1090:audio",
    JSON.stringify({ url: "https://s1.liveatc.net/old", volume: 0.5 }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        channels: [],
        providers: { icecast: "disabled", ibonav: "disabled" },
        configured: false,
      }),
    ),
  );
  const { result } = renderHook(() => useAtcChannels());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.channels).toEqual([]);
  const custom = {
    ...first,
    id: "custom:https://receiver/stream",
    provider: "custom" as const,
    streamUrl: "https://receiver/stream",
  };
  act(() => result.current.save(custom));
  expect(JSON.parse(localStorage.getItem("vector1090:atc")!)[0].streamUrl).toBe(
    custom.streamUrl,
  );
  act(() => result.current.remove(custom.id));
  expect(result.current.saved).toEqual([]);
});
it("keeps custom channels usable when provider discovery fails", async () => {
  localStorage.setItem(
    "vector1090:atc",
    JSON.stringify([{ streamUrl: "https://receiver/stream" }]),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  const { result } = renderHook(() => useAtcChannels());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.channels).toHaveLength(1);
  expect(result.current.error).toContain("discovery unavailable");
});
it("offers grouped searchable channels, offline status, keyboard choice, and safe custom saves", () => {
  const onSelect = vi.fn(),
    onSave = vi.fn();
  render(
    createElement(AtcPicker, {
      channels: [first, { ...backup, online: false }],
      current: first,
      center: { lat: 51, lon: 0 },
      saved: [],
      onSelect,
      onSave,
      onRemove: vi.fn(),
    }),
  );
  fireEvent.click(screen.getByLabelText("Choose ATC channel"));
  expect(screen.getByRole("group", { name: "EGLL" })).toBeTruthy();
  expect(screen.getByTitle("Offline")).toBeTruthy();
  const search = screen.getByRole("combobox", { name: "Search ATC channels" });
  fireEvent.change(search, { target: { value: "ibonav" } });
  expect(
    within(screen.getByRole("listbox")).getAllByRole("option"),
  ).toHaveLength(1);
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ id: backup.id }),
  );
  fireEvent.click(screen.getByLabelText("Choose ATC channel"));
  fireEvent.click(screen.getByText("Add a stream URL"));
  fireEvent.change(screen.getByLabelText("Stream URL"), {
    target: { value: "https://receiver/stream" },
  });
  fireEvent.change(screen.getByLabelText("Airport ICAO"), {
    target: { value: "egll" },
  });
  fireEvent.submit(screen.getByLabelText("Stream URL").closest("form")!);
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "custom", airportIcao: "EGLL" }),
  );
});
it("shows the empty state, never autoplays, and removes the old stored stream URL", async () => {
  localStorage.setItem(
    "vector1090:audio",
    JSON.stringify({ url: "https://s1.liveatc.net/old", volume: 0.2 }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        channels: [],
        providers: { icecast: "disabled", ibonav: "disabled" },
        configured: false,
      }),
    ),
  );
  render(createElement(AtcPlayer));
  await screen.findByText(
    "Add your own receiver with ATC_ICECAST_URL or paste a stream URL",
  );
  expect(screen.getByLabelText("Play audio").hasAttribute("disabled")).toBe(
    true,
  );
  expect(instances).toHaveLength(0);
  expect(localStorage.getItem("vector1090:audio")).not.toContain("liveatc");
});
it("waits for discovery before choosing the own receiver over saved custom channels, and credits the active backup", async () => {
  vi.useFakeTimers();
  localStorage.setItem(
    "vector1090:atc",
    JSON.stringify([
      { name: "Saved custom", streamUrl: "https://receiver/custom" },
    ]),
  );
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ),
  );
  await act(async () => {
    render(createElement(AtcPlayer));
  });
  expect(screen.getByLabelText("Choose ATC channel").textContent).toContain(
    "Choose a channel",
  );
  await act(async () =>
    resolve(
      Response.json({
        channels: [first, backup],
        configured: true,
        providers: { icecast: "ok", ibonav: "ok" },
      }),
    ),
  );
  expect(screen.getByLabelText("Choose ATC channel").textContent).toContain(
    "Main Tower",
  );
  fireEvent.click(screen.getByLabelText("Play audio"));
  act(() => instances[0].onerror?.());
  act(() => vi.advanceTimersByTime(1000));
  act(() => instances[1].onplaying?.());
  expect(
    screen.getByRole("link", { name: "ibonav.aero" }).getAttribute("href"),
  ).toBe("https://ibonav.aero");
  expect(screen.getByText("Switched to backup: Backup Tower")).toBeTruthy();
});
