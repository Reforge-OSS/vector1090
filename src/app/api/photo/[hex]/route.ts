import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
interface Photo {
  thumbnail: string;
  large: string;
  link: string;
  photographer: string;
}
const cache = new Map<string, { expires: number; photos: Photo[] }>();
const TTL = 3600_000;
const reply = (photos: Photo[], status = 200) =>
  NextResponse.json(
    { photo: photos[0] ?? null, photos },
    { status, headers: { "Cache-Control": "public, max-age=3600" } },
  );
export async function GET(
  _request: Request,
  { params }: { params: { hex: string } },
) {
  if (!/^[0-9a-f]{6}$/i.test(params.hex))
    return NextResponse.json({ photo: null, photos: [] }, { status: 400 });
  const hex = params.hex.toLowerCase();
  const hit = cache.get(hex);
  if (hit && hit.expires > Date.now()) return reply(hit.photos);
  let photos: Photo[] = [];
  try {
    const upstream = await fetch(
      `https://api.planespotters.net/pub/photos/hex/${hex}`,
      {
        headers: {
          "User-Agent":
            process.env.PHOTO_USER_AGENT ||
            "vector1090/1.0 (+https://github.com/Reforge-OSS/vector1090)",
        },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
    if (!upstream.ok) throw new Error("photo_upstream_failed");
    const data = await upstream.json();
    if (!Array.isArray(data.photos)) throw new Error("invalid_photos");
    photos = data.photos.map((item: Record<string, unknown>) => {
      const first = item as {
        thumbnail_large?: { src?: string };
        thumbnail?: { src?: string };
        link?: string;
        photographer?: string;
      };
      return {
        thumbnail: first.thumbnail_large?.src ?? first.thumbnail?.src ?? "",
        large: first.thumbnail_large?.src ?? first.thumbnail?.src ?? "",
        link: first.link ?? "",
        photographer: first.photographer ?? "",
      };
    });
  } catch {
    return NextResponse.json(
      { photo: null, photos: [] },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  for (const [key, value] of cache)
    if (value.expires <= Date.now()) cache.delete(key);
  if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
  cache.set(hex, { expires: Date.now() + TTL, photos });
  return reply(photos);
}
