import { channelType, type AtcChannel } from "./atc";
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, 200) : "";
const code = (value: unknown, length: number) =>
  new RegExp("^[A-Z0-9]{" + length + "}$").test(text(value).toUpperCase())
    ? text(value).toUpperCase()
    : null;
const coordinate = (value: unknown, max: number) =>
  value !== "" &&
  value !== null &&
  value !== undefined &&
  Number.isFinite(Number(value)) &&
  Math.abs(Number(value)) <= max
    ? Number(value)
    : null;
export function mountPath(value: unknown): string | null {
  const path = typeof value === "string" ? value.trim() : "";
  return path.length <= 200 &&
    /^\/[a-zA-Z0-9_./-]+$/.test(path) &&
    !path.includes("..") &&
    !path.includes("//")
    ? path
    : null;
}
export function icecastSources(value: unknown): Map<string, RecordValue> {
  const sources = record(record(value).icestats).source;
  const result = new Map<string, RecordValue>();
  for (const item of Array.isArray(sources)
    ? sources
    : sources
      ? [sources]
      : []) {
    const source = record(item);
    let path = mountPath(source.mount);
    try {
      path ??= mountPath(new URL(text(source.listenurl)).pathname);
    } catch {}
    if (path) result.set(path, source);
  }
  return result;
}
export function parseMapping(value: string | undefined): RecordValue {
  try {
    return record(JSON.parse(value ?? "{}"));
  } catch {
    return {};
  }
}
function channel(
  provider: "icecast" | "ibonav",
  mount: string,
  meta: RecordValue,
  online: boolean,
): AtcChannel {
  const id = provider + ":" + mount;
  return {
    id,
    provider,
    airportIcao: code(meta.icao, 4),
    airportIata: code(meta.iata, 3),
    city: text(meta.city) || null,
    country: text(meta.country) || null,
    name: text(meta.name) || mount.slice(1),
    frequency: text(meta.frequency) || null,
    type: channelType(meta.type ?? meta.name ?? mount),
    online,
    streamUrl: "/api/atc/stream?id=" + encodeURIComponent(id),
    latitude: coordinate(meta.lat, 90),
    longitude: coordinate(meta.lon, 180),
  };
}
export function parseIcecast(
  value: unknown,
  labels: RecordValue = {},
  airports: string | RecordValue = "",
): AtcChannel[] {
  const sources = icecastSources(value);
  const mounts = new Set([
    ...sources.keys(),
    ...Object.keys(labels).filter((k) => mountPath(k)),
  ]);
  return [...mounts].map((mount) => {
    const source = sources.get(mount);
    const label =
      typeof labels[mount] === "string"
        ? { name: labels[mount] }
        : record(labels[mount]);
    const name =
      text(source?.server_name) ||
      text(source?.server_description) ||
      mount.slice(1);
    return channel(
      "icecast",
      mount,
      {
        name,
        type: channelType(name + " " + mount),
        icao: typeof airports === "string" ? airports : airports[mount],
        ...label,
      },
      !!source,
    );
  });
}
export function parseIbonav(value: unknown, status: unknown): AtcChannel[] {
  if (!Array.isArray(value)) return [];
  const sources = icecastSources(status);
  const channels: AtcChannel[] = [];
  for (const raw of value) {
    const page = record(raw),
      map = record(record(page["ais-settings"])["show-on-map"]);
    for (const rawChannel of Array.isArray(page.channels)
      ? page.channels
      : []) {
      const c = record(rawChannel),
        mount = mountPath(typeof c.url === "string" ? "/" + c.url : "");
      if (!mount) continue;
      const associated = Array.isArray(c["associated-aerodromes"])
        ? c["associated-aerodromes"]
        : [];
      const pageName = text(page.name),
        airport =
          page.category === "aerodrome"
            ? code(page.ident, 4)
            : associated.length === 1
              ? code(associated[0], 4)
              : null;
      const iata = pageName.match(/^[A-Z0-9]{4}\/([A-Z]{3})\b/)?.[1];
      const service = [
        ...(Array.isArray(c["ad-2-18"]) ? c["ad-2-18"] : []),
        ...(Array.isArray(c["ad-3-17"]) ? c["ad-3-17"] : []),
      ]
        .map((s) => text(record(s)["_2-call-sign"]))
        .find(Boolean);
      channels.push(
        channel(
          "ibonav",
          mount,
          {
            icao: airport,
            iata,
            name: text(c.name) || service || pageName + " · " + text(c.freq),
            city:
              text(page.city) ||
              (airport ? pageName.split(" - ")[1]?.split(" ")[0] : null),
            country:
              text(page.country) ||
              (airport?.startsWith("LT") ? "Türkiye" : null),
            frequency: c.freq,
            type: channelType(text(c.url) + " " + text(c.type)),
            lat: map["center-lat"],
            lon: map["center-long"],
          },
          sources.has(mount),
        ),
      );
    }
  }
  return channels.filter(
    (c, i, all) => all.findIndex((x) => x.id === c.id) === i,
  );
}
