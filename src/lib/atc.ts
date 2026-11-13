import { distanceNm } from "./geo";
export type AtcProvider = "icecast" | "ibonav" | "custom";
export interface AtcChannel {
  id: string;
  provider: AtcProvider;
  airportIcao: string | null;
  airportIata: string | null;
  city: string | null;
  country: string | null;
  name: string;
  frequency: string | null;
  type: string;
  streamUrl: string;
  online: boolean;
  latitude: number | null;
  longitude: number | null;
}
export const providerName = (provider: AtcProvider) =>
  ({ icecast: "Own receiver", ibonav: "ibonav.aero", custom: "Custom URL" })[
    provider
  ];
export function streamUrl(value: unknown): string | null {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname === "liveatc.net" ||
      url.hostname.endsWith(".liveatc.net")
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
export function channelType(value: unknown): string {
  const text = String(value ?? "").toLowerCase();
  if (/tower|twr/.test(text)) return "tower";
  if (/ground|gnd/.test(text)) return "ground";
  if (/approach|app/.test(text)) return "approach";
  if (/departure|dep/.test(text)) return "departure";
  if (/atis/.test(text)) return "atis";
  if (/fir|acc|control/.test(text)) return "control";
  if (/aerodrome|heliport/.test(text)) return "tower";
  return "other";
}
export function nextAtcChannel(
  channels: AtcChannel[],
  current: AtcChannel,
  tried: ReadonlySet<string>,
) {
  if (tried.size >= 4 || (!current.airportIcao && !current.airportIata))
    return null;
  const weight = (c: AtcChannel) =>
    (c.type === current.type ? 0 : 10) +
    (c.provider === current.provider ? 0 : 3) +
    { icecast: 0, ibonav: 1, custom: 2 }[c.provider];
  const channel = channels
    .filter(
      (c) =>
        c.id !== current.id &&
        !tried.has(c.id) &&
        c.online &&
        (current.airportIcao
          ? c.airportIcao === current.airportIcao
          : c.airportIata === current.airportIata),
    )
    .sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name))[0];
  return channel
    ? {
        channel,
        delayMs: Math.min(4000, 1000 * 2 ** Math.max(0, tried.size - 1)),
      }
    : null;
}
export function sortAtcChannels(
  channels: AtcChannel[],
  search: string,
  center: { lat: number; lon: number } | null,
) {
  const query = search.trim().toLowerCase();
  const distance = (c: AtcChannel) =>
    center && c.latitude !== null && c.longitude !== null
      ? distanceNm(center.lat, center.lon, c.latitude, c.longitude)
      : Infinity;
  return channels
    .filter((c) =>
      [
        c.airportIcao,
        c.airportIata,
        c.city,
        c.country,
        c.name,
        c.frequency,
        providerName(c.provider),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    )
    .sort((a, b) => {
      const delta = distance(a) - distance(b);
      return (
        (Number.isNaN(delta) ? 0 : delta) ||
        (a.airportIcao ?? a.airportIata ?? "~").localeCompare(
          b.airportIcao ?? b.airportIata ?? "~",
        ) ||
        Number(b.online) - Number(a.online) ||
        a.name.localeCompare(b.name)
      );
    });
}
export function savedAtcChannels(value: unknown): AtcChannel[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 50)
    .flatMap((entry, i) => {
      if (!entry || typeof entry !== "object") return [];
      const url = streamUrl(entry.streamUrl);
      if (!url) return [];
      const text = (key: string) =>
        typeof entry[key] === "string" ? entry[key].trim().slice(0, 120) : "";
      return [
        {
          id: "custom:" + url,
          provider: "custom" as const,
          name: text("name") || "Saved stream " + (i + 1),
          airportIcao: /^[A-Z0-9]{4}$/.test(text("airportIcao").toUpperCase())
            ? text("airportIcao").toUpperCase()
            : null,
          airportIata: /^[A-Z]{3}$/.test(text("airportIata").toUpperCase())
            ? text("airportIata").toUpperCase()
            : null,
          city: text("city") || null,
          country: text("country") || null,
          frequency: text("frequency") || null,
          type: channelType(entry.type),
          streamUrl: url,
          online: true,
          latitude: null,
          longitude: null,
        },
      ];
    })
    .filter((c, i, all) => all.findIndex((other) => other.id === c.id) === i);
}
