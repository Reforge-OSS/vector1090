import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
interface Photo { thumbnail: string; large: string; link: string; photographer: string }
const cache = new Map<string, { expires: number; photo: Photo | null }>();
const TTL = 3600_000;
const reply = (photo: Photo | null, status = 200) => NextResponse.json({ photo }, { status, headers: { "Cache-Control": "public, max-age=3600" } });
export async function GET(_request: Request, { params }: { params: { hex: string } }) {
  if (!/^[0-9a-f]{6}$/i.test(params.hex)) return NextResponse.json({ photo: null }, { status: 400 });
  const hex = params.hex.toLowerCase();
  const hit = cache.get(hex);
  if (hit && hit.expires > Date.now()) return reply(hit.photo);
  let photo: Photo | null = null;
  try {
    const upstream = await fetch(`https://api.planespotters.net/pub/photos/hex/${hex}`, {
      headers: { "User-Agent": process.env.PHOTO_USER_AGENT || "vector1090/1.0 (+https://github.com/Reforge-OSS/vector1090)" }, signal: AbortSignal.timeout(8000), cache: "no-store",
    });
    if (upstream.ok) {
      const data = await upstream.json();
      const first = data.photos?.[0];
      if (first) photo = {
        thumbnail: first.thumbnail_large?.src ?? first.thumbnail?.src ?? "",
        large: first.thumbnail_large?.src ?? first.thumbnail?.src ?? "",
        link: first.link ?? "", photographer: first.photographer ?? "",
      };
    }
  } catch { /* Photos are optional. */ }
  for (const [key, value] of cache) if (value.expires <= Date.now()) cache.delete(key);
  if (cache.size >= 5000) cache.delete(cache.keys().next().value!);
  cache.set(hex, { expires: Date.now() + TTL, photo });
  return reply(photo);
}
