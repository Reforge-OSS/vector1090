import { parseIcecast, parseIbonav, parseMapping } from "./atcProviders";
import type { AtcChannel } from "./atc";
type Provider = "icecast" | "ibonav";
type ProviderStatus = "ok" | "disabled" | "error" | "rate_limited";
interface Result {
  channels: AtcChannel[];
  status: ProviderStatus;
  expires: number;
}
interface State {
  cache: Map<Provider, Result>;
  pending: Map<Provider, Promise<Result>>;
  ibonavDeadline: number;
}
const key = Symbol.for("vector1090.atc");
const globals = globalThis as unknown as Record<symbol, State | undefined>;
const state: State = (globals[key] ??= {
  cache: new Map<Provider, Result>(),
  pending: new Map<Provider, Promise<Result>>(),
  ibonavDeadline: 0,
});
const { cache, pending } = state;
const ibonavBase = "https://atc1.ibosoft.net.tr:2096";
const agent = "vector1090/1.2 (+https://github.com/Reforge-OSS/vector1090)";
export function atcRetryAfter(value: string | null): number {
  const seconds =
    value && /^\d+(\.\d+)?$/.test(value)
      ? Number(value)
      : (Date.parse(value ?? "") - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60;
}
export function limitIbonav(value: string | null) {
  state.ibonavDeadline = Math.max(
    state.ibonavDeadline,
    Date.now() + atcRetryAfter(value) * 1000,
  );
}
export function ibonavRetryAfter() {
  return Math.max(0, Math.ceil((state.ibonavDeadline - Date.now()) / 1000));
}
function ownBase() {
  const url = new URL(process.env.ATC_ICECAST_URL ?? "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.hostname === "liveatc.net" ||
    url.hostname.endsWith(".liveatc.net")
  )
    throw new Error("Invalid receiver");
  return url;
}
export function atcUpstream(provider: Provider, path: string) {
  const url =
    provider === "ibonav"
      ? new URL(path, ibonavBase)
      : new URL(path, ownBase());
  const headers: Record<string, string> = { "User-Agent": agent };
  if (provider === "ibonav") {
    if (!process.env.IBONAV_ATC_TOKEN) throw new Error("Provider disabled");
    url.searchParams.set("access_token", process.env.IBONAV_ATC_TOKEN);
  } else if (url.username || url.password) {
    headers.Authorization =
      "Basic " +
      Buffer.from(
        decodeURIComponent(url.username) +
          ":" +
          decodeURIComponent(url.password),
      ).toString("base64");
    url.username = "";
    url.password = "";
  }
  return { url, headers };
}
async function json(provider: Provider, path: string, configuration = false) {
  const request = configuration
    ? {
        url: new URL(
          "https://ibonav.aero/atc-files/configurations/channels.json",
        ),
        headers: { "User-Agent": agent },
      }
    : atcUpstream(provider, path);
  const response = await fetch(request.url, {
    headers: request.headers,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 429 && provider === "ibonav")
    limitIbonav(response.headers.get("Retry-After"));
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Provider unavailable");
  }
  return response.json() as Promise<unknown>;
}
async function providerChannels(provider: Provider): Promise<Result> {
  const enabled =
    provider === "icecast"
      ? !!process.env.ATC_ICECAST_URL
      : !!process.env.IBONAV_ATC_TOKEN;
  if (!enabled) return { channels: [], status: "disabled", expires: 0 };
  const previous = cache.get(provider);
  if (provider === "ibonav" && ibonavRetryAfter())
    return {
      channels: (previous?.channels ?? []).map((c) => ({
        ...c,
        online: false,
      })),
      status: "rate_limited",
      expires: state.ibonavDeadline,
    };
  if (previous && previous.expires > Date.now()) return previous;
  const running = pending.get(provider);
  if (running) return running;
  let fallback = previous?.channels ?? [];
  const request = (async (): Promise<Result> => {
    try {
      let channels: AtcChannel[];
      if (provider === "icecast") {
        const base = ownBase();
        const path = base.pathname.replace(/\/$/, "") + "/status-json.xsl";
        const airports = process.env.ATC_ICECAST_AIRPORT ?? "";
        const labels = parseMapping(process.env.ATC_ICECAST_LABELS);
        const mapping = airports.startsWith("{")
          ? parseMapping(airports)
          : airports;
        if (!fallback.length) fallback = parseIcecast({}, labels, mapping);
        channels = parseIcecast(await json(provider, path), labels, mapping);
      } else {
        const list = await json(provider, "", true);
        fallback = parseIbonav(list, {});
        const status = await json(provider, "/status-json.xsl");
        channels = parseIbonav(list, status);
      }
      return { channels, status: "ok", expires: Date.now() + 60000 };
    } catch {
      return {
        channels: fallback.map((c) => ({ ...c, online: false })),
        status:
          provider === "ibonav" && ibonavRetryAfter()
            ? "rate_limited"
            : "error",
        expires: Math.max(
          Date.now() + 60000,
          provider === "ibonav" ? state.ibonavDeadline : 0,
        ),
      };
    }
  })();
  pending.set(provider, request);
  try {
    const result = await request;
    cache.set(provider, result);
    return result;
  } finally {
    pending.delete(provider);
  }
}
export async function atcChannels() {
  const [icecast, ibonav] = await Promise.all([
    providerChannels("icecast"),
    providerChannels("ibonav"),
  ]);
  return {
    channels: [...icecast.channels, ...ibonav.channels],
    providers: { icecast: icecast.status, ibonav: ibonav.status },
    configured: icecast.status !== "disabled" || ibonav.status !== "disabled",
    retryAfter: ibonavRetryAfter() || undefined,
  };
}
