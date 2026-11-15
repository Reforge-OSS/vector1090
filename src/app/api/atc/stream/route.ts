import {
  atcChannel,
  atcUpstream,
  ibonavRetryAfter,
  limitIbonav,
} from "@/lib/atcServer";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const channel = await atcChannel(id);
  const failure = (status: number, retryAfter = 0) =>
    Response.json(
      { error: "Stream unavailable" },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
        },
      },
    );
  if (!channel || channel.provider === "custom") return failure(404);
  if (channel.provider === "ibonav" && ibonavRetryAfter())
    return failure(429, ibonavRetryAfter());
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  const cleanup = () => {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  };
  try {
    if (request.signal.aborted) controller.abort();
    const upstream = atcUpstream(
      channel.provider,
      channel.id.slice(channel.provider.length + 1),
    );
    const response = await fetch(upstream.url, {
      headers: upstream.headers,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (
      !response.ok ||
      !response.body ||
      !/^(audio\/|application\/(ogg|octet-stream))/i.test(
        response.headers.get("Content-Type") ?? "",
      )
    ) {
      if (response.status === 429 && channel.provider === "ibonav")
        limitIbonav(response.headers.get("Retry-After"));
      await response.body?.cancel();
      cleanup();
      return failure(
        response.status === 429 ? 429 : 502,
        channel.provider === "ibonav" ? ibonavRetryAfter() : 0,
      );
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const next = await reader.read();
          if (next.done) {
            cleanup();
            output.close();
          } else output.enqueue(next.value);
        } catch (error) {
          cleanup();
          output.error(error);
        }
      },
      async cancel(reason) {
        controller.abort();
        cleanup();
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type")!,
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    cleanup();
    return failure(502);
  }
}
