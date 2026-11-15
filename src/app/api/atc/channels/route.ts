import { atcChannels } from "@/lib/atcServer";
export const dynamic = "force-dynamic";
export async function GET() {
  const result = await atcChannels();
  return Response.json(result, {
    status:
      result.retryAfter && !result.channels.some((c) => c.online) ? 429 : 200,
    headers: {
      "Cache-Control": "no-store",
      ...(result.retryAfter
        ? { "Retry-After": String(result.retryAfter) }
        : {}),
    },
  });
}
