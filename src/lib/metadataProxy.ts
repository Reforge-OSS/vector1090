import { NextResponse } from "next/server";

const cache = new Map<
  string,
  { expires: number; data: unknown; ttl: number }
>();
const pending = new Map<string, Promise<Response>>();
export async function metadataResponse(
  kind: "aircraft" | "callsign",
  id: string,
  output: "airframe" | "route",
  parse: (value: unknown) => unknown,
): Promise<Response> {
  const key = kind + ":" + id;
  const reply = (data: unknown, ttl: number) =>
    NextResponse.json(
      { [output]: data },
      { headers: { "Cache-Control": "public, max-age=" + ttl } },
    );
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now())
    return reply(cached.data, cached.ttl);
  const inflight = pending.get(key);
  if (inflight) return (await inflight).clone();
  const request = (async () => {
    try {
      const upstream = await fetch(
        "https://api.adsbdb.com/v0/" + kind + "/" + encodeURIComponent(id),
        {
          headers: {
            "User-Agent":
              "vector1090/1.2 (+https://github.com/Reforge-OSS/vector1090)",
          },
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        },
      );
      if (!upstream.ok) throw new Error("metadata_upstream_failed");
      const json = await upstream.json();
      const data = parse(
        json?.response?.[kind === "aircraft" ? "aircraft" : "flightroute"],
      );
      if (!data) throw new Error("invalid_metadata");
      const ttl = 86400;
      for (const [key, entry] of cache)
        if (entry.expires <= Date.now()) cache.delete(key);
      if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
      cache.set(key, { data, ttl, expires: Date.now() + ttl * 1000 });
      return reply(data, ttl);
    } catch {
      return NextResponse.json(
        { [output]: null },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  })();
  pending.set(key, request);
  try {
    return (await request).clone();
  } finally {
    pending.delete(key);
  }
}
