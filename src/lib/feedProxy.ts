import { mergeFeeds, normalizePublicQuery } from "./feeds";
import { normalizeFeed } from "./normalize";
import type { Aircraft, PublicQuery, SourceStatus } from "./types";

export interface SourceResult {
  aircraft: Aircraft[];
  now: number;
  status: Exclude<SourceStatus, "disabled">;
  available: boolean;
  cache: "hit" | "miss" | "coalesced" | "cooldown";
  retryAfter?: number;
  stale?: boolean;
  error?: string;
}

interface CacheEntry {
  expires: number;
  result: SourceResult;
  lastGood?: SourceResult;
}

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly limited = false,
  ) {
    super(message);
  }
}

export function configuredReceiverUrl(): string | undefined {
  return (
    process.env.LOCAL_RECEIVER_URL?.trim() ||
    process.env.LOCAL_AIRCRAFT_URL?.trim() ||
    undefined
  );
}

function retrySeconds(value: string | null): number {
  if (!value?.trim()) return 30;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.max(1, Math.ceil((date - Date.now()) / 1000))
    : 30;
}

export class FeedProxy {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<SourceResult>>();
  private publicRetryNotBefore = 0;

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  publicFeed(query: PublicQuery): Promise<SourceResult> {
    const normalized = normalizePublicQuery(query);
    const key = "public:" + JSON.stringify(normalized);
    if (Date.now() < this.publicRetryNotBefore) {
      const previous = this.cache.get(key)?.lastGood;
      return Promise.resolve({
        aircraft: previous?.aircraft ?? [],
        now: previous?.now ?? Date.now() / 1000,
        available: !!previous,
        status: "rate_limited",
        retryAfter: this.remainingCooldown(),
        stale: previous ? true : undefined,
        error: "rate_limited",
        cache: "cooldown",
      });
    }
    return this.memoize(key, 8000, () => this.loadPublic(normalized));
  }

  localFeed(url: string): Promise<SourceResult> {
    return this.memoize("local:" + url, 1000, () => this.request(url, "local"));
  }

  private remainingCooldown(): number {
    return Math.max(
      1,
      Math.ceil((this.publicRetryNotBefore - Date.now()) / 1000),
    );
  }

  private async memoize(
    key: string,
    ttl: number,
    load: () => Promise<SourceResult>,
  ): Promise<SourceResult> {
    const previous = this.cache.get(key);
    if (previous && previous.expires > Date.now())
      return { ...previous.result, cache: "hit" };
    const pending = this.pending.get(key);
    if (pending) return { ...(await pending), cache: "coalesced" };
    const request = load()
      .catch((error) => ({
        aircraft: [],
        now: Date.now() / 1000,
        status: "error" as const,
        available: false,
        error:
          error instanceof UpstreamError
            ? error.message
            : "upstream_fetch_failed",
        cache: "miss" as const,
      }))
      .then((result) => {
        if (result.status === "rate_limited" && previous?.lastGood) {
          result = {
            ...previous.lastGood,
            status: "rate_limited",
            retryAfter: this.remainingCooldown(),
            stale: true,
            error: "rate_limited",
            cache: "miss",
          };
        }
        const lastGood = result.status === "ok" ? result : previous?.lastGood;
        this.cache.delete(key);
        this.cache.set(key, {
          result,
          lastGood,
          expires:
            result.status === "rate_limited"
              ? this.publicRetryNotBefore
              : Date.now() + ttl,
        });
        while (this.cache.size > 256)
          this.cache.delete(this.cache.keys().next().value!);
        return result;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }

  private async loadPublic(query: PublicQuery): Promise<SourceResult> {
    const base = (process.env.ADSB_API_BASE ?? "https://api.adsb.lol").replace(
      /\/$/,
      "",
    );
    const paths =
      query.scope === "global"
        ? ["/v2/mil", "/v2/sqk/7700"]
        : [`/v2/lat/${query.lat}/lon/${query.lon}/dist/${query.radius}`];
    const results = await Promise.allSettled(
      paths.map((path) => this.request(base + path, "public")),
    );
    const good = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const limited = errors.some(
      (error) => error instanceof UpstreamError && error.limited,
    );
    return {
      aircraft: mergeFeeds(
        [],
        good.flatMap((result) => result.aircraft),
      ),
      now: good.length
        ? Math.max(...good.map((result) => result.now))
        : Date.now() / 1000,
      available: good.length > 0,
      status: limited ? "rate_limited" : errors.length ? "error" : "ok",
      retryAfter: limited ? this.remainingCooldown() : undefined,
      error: limited
        ? "rate_limited"
        : errors.length
          ? errors[0] instanceof UpstreamError
            ? errors[0].message
            : "upstream_fetch_failed"
          : undefined,
      cache: "miss",
    };
  }

  private async request(
    url: string,
    source: Aircraft["feedSource"],
  ): Promise<SourceResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const headers: Record<string, string> = {
        "User-Agent":
          "vector1090/1.0 (+https://github.com/Reforge-OSS/vector1090)",
      };
      if (source === "public" && process.env.ADSB_API_KEY)
        headers["x-api-key"] = process.env.ADSB_API_KEY;
      const upstream = await this.fetcher(url, {
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
      if (source === "public" && upstream.status === 429) {
        this.publicRetryNotBefore = Math.max(
          this.publicRetryNotBefore,
          Date.now() + retrySeconds(upstream.headers.get("Retry-After")) * 1000,
        );
        throw new UpstreamError("rate_limited", true);
      }
      if (!upstream.ok) throw new UpstreamError(`upstream_${upstream.status}`);
      const json: unknown = await upstream.json();
      const timestamp =
        json &&
        typeof json === "object" &&
        "now" in json &&
        typeof json.now === "number" &&
        Number.isFinite(json.now)
          ? json.now
          : Date.now() / 1000;
      const now = timestamp > 1e12 ? timestamp / 1000 : timestamp;
      return {
        aircraft: normalizeFeed(json, source),
        now,
        status: "ok",
        available: true,
        cache: "miss",
      };
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      throw new UpstreamError(
        error instanceof Error && error.name === "AbortError"
          ? "upstream_timeout"
          : "upstream_fetch_failed",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
