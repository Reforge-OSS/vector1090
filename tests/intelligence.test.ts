import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aircraftCountry } from "@/lib/countries";
import { positionSourceName } from "@/lib/intelligence";
import { sparklinePath } from "@/lib/history";

describe("ICAO address allocations", () => {
  it.each([
    ["004000", "Zimbabwe"],
    ["0047ff", "Zimbabwe"],
    ["4005BF", "United Kingdom"],
    ["400000", "Bermuda"],
    ["4ca707", "Ireland"],
    ["A00000", "United States"],
    ["AFFFFF", "United States"],
    ["840000", "Japan"],
    ["780000", "China"],
  ])("maps %s to %s", (hex, country) =>
    expect(aircraftCountry(hex)).toBe(country),
  );
  it.each(["000000", "004800", "ffffff", "../abc", "0x4005bf", "", "4005bff"])(
    "rejects invalid or unassigned addresses: %s",
    (hex) => expect(aircraftCountry(hex)).toBeNull(),
  );
});
it("humanizes position sources", () => {
  expect(positionSourceName("adsb_icao")).toBe("ADS-B");
  expect(positionSourceName("tisb_trackfile")).toBe("TIS-B");
  expect(positionSourceName("mlat")).toBe("MLAT");
  expect(positionSourceName(null)).toBeNull();
});
it("plots session time, keeps null gaps and handles empty/flat history", () => {
  expect(sparklinePath([], "alt")).toBeNull();
  expect(sparklinePath([{ time: 0, alt: null, gs: null }], "alt")).toBeNull();
  const points = [
    { time: 0, alt: 100, gs: 200 },
    { time: 10, alt: null, gs: 200 },
    { time: 20, alt: 300, gs: 200 },
  ];
  expect(sparklinePath(points, "alt")).toBe("M4.0,58.0  M276.0,6.0");
  expect(sparklinePath(points, "gs")).toBe("M4.0,32.0 L140.0,32.0 L276.0,32.0");
});

const fetcher = vi.fn<typeof fetch>();
const data = {
  response: {
    aircraft: {
      type: "777 236ER",
      icao_type: "B772",
      manufacturer: "Boeing",
      registration: "G-VIIG",
      registered_owner: "British Airways",
      registered_owner_operator_flag_code: "BAW",
    },
    flightroute: {
      callsign: "BAW117",
      airline: { name: "British Airways", icao: "BAW", iata: "BA" },
      origin: {
        icao_code: "EGLL",
        iata_code: "LHR",
        name: "London Heathrow Airport",
        municipality: "London",
        latitude: 51.4706,
        longitude: -0.46194,
      },
      destination: {
        icao_code: "KJFK",
        iata_code: "JFK",
        name: "John F Kennedy International Airport",
        municipality: "New York",
        latitude: 40.6398,
        longitude: -73.7789,
      },
    },
  },
};
beforeEach(() => {
  vi.resetModules();
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.useRealTimers());
async function request(kind: "airframe" | "route", id?: string) {
  const request = new Request("http://localhost/api/metadata");
  if (kind === "airframe")
    return (await import("@/app/api/airframe/[hex]/route")).GET(request, {
      params: { hex: id ?? "4005BF" },
    });
  return (await import("@/app/api/callsign/[callsign]/route")).GET(request, {
    params: { callsign: id ?? "baw117" },
  });
}
describe.each(["airframe", "route"] as const)("%s proxy", (kind) => {
  it("normalizes, coalesces and caches successful responses for a day", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(async () => Response.json(data));
    const [first, second] = await Promise.all([request(kind), request(kind)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const body = await first.json();
    expect(await second.json()).toEqual(body);
    if (kind === "airframe")
      expect(body.airframe).toMatchObject({
        typeDescription: "777 236ER",
        owner: "British Airways",
      });
    else
      expect(body.route).toMatchObject({
        origin: {
          icao: "EGLL",
          iata: "LHR",
          city: "London",
          lat: 51.4706,
          lon: -0.46194,
        },
        destination: { icao: "KJFK" },
        airline: { name: "British Airways" },
      });
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      "User-Agent":
        "vector1090/1.2 (+https://github.com/Reforge-OSS/vector1090)",
    });
    await request(kind);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 86400_001);
    await request(kind);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not cache upstream not-found responses", async () => {
    fetcher.mockImplementation(async () => new Response(null, { status: 404 }));
    const response = await request(kind);
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ [kind]: null });
    await request(kind);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["http", "network", "timeout", "malformed"])(
    "does not cache %s failures and retries",
    async (failure) => {
      if (failure === "network" || failure === "timeout")
        fetcher.mockRejectedValueOnce(
          failure === "timeout"
            ? new DOMException("timeout", "AbortError")
            : new Error("offline"),
        );
      else
        fetcher.mockResolvedValueOnce(
          failure === "http"
            ? new Response(null, { status: 503 })
            : Response.json({}),
        );
      const response = await request(kind);
      expect(response.status).toBe(502);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      fetcher.mockResolvedValueOnce(Response.json(data));
      expect((await request(kind)).status).toBe(200);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it("validates identifiers before contacting upstream", async () => {
    expect((await request(kind, "../bad")).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("photo arrays", () => {
  it("returns every photo with individual credits and keeps the first-photo alias", async () => {
    const photos = [
      {
        thumbnail_large: { src: "https://t.plnspttrs.net/one.jpg" },
        link: "https://planespotters.net/one",
        photographer: "One",
      },
      {
        thumbnail: { src: "https://t.plnspttrs.net/two.jpg" },
        link: "https://planespotters.net/two",
        photographer: "Two",
      },
    ];
    fetcher.mockResolvedValueOnce(Response.json({ photos }));
    const { GET } = await import("@/app/api/photo/[hex]/route");
    const response = await GET(new Request("http://localhost"), {
      params: { hex: "abc123" },
    });
    const body = await response.json();
    expect(body.photos).toHaveLength(2);
    expect(body.photos[1]).toEqual({
      thumbnail: "https://t.plnspttrs.net/two.jpg",
      large: "https://t.plnspttrs.net/two.jpg",
      photographer: "Two",
      link: "https://planespotters.net/two",
    });
    expect(body.photo).toEqual(body.photos[0]);
  });
  it.each([
    { photos: [] },
    {
      photos: [
        { thumbnail: "/one", photographer: "One" },
        { thumbnail: "/two", photographer: "Two" },
      ],
    },
  ])(
    "deduplicates array lookups and preserves empty results",
    async ({ photos }) => {
      fetcher.mockImplementation(async () => Response.json({ photos }));
      const { loadPhotos } = await import("@/lib/photos");
      expect(
        await Promise.all([loadPhotos("ABC123"), loadPhotos("abc123")]),
      ).toEqual([photos, photos]);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
