import { hostOf } from "../normalize/url";
import { createHostGate, createLimiter, sleep } from "./pool";
import { contentHash, HttpCache } from "./cache";

/**
 * The one fetch path for the whole pipeline.
 *
 * We never use rss-parser's `parseURL`: in testing it hung for over two minutes
 * on these feeds (and 403s on endpoints.news), while native fetch + parseString
 * returned in seconds. Fetch here, parse from the string.
 *
 * The Accept header is load-bearing, not decoration — endpoints.news is
 * header-sensitive and rejects requests that don't look like a real client.
 */

/**
 * Identifies the tool and a contact, in the `Mozilla/5.0 (compatible; …)` form
 * publishers' WAFs expect. A bare `biotech-insights/0.2` gets a 403 from
 * endpoints.news — verified. This is not spoofing a browser: the bot name and
 * contact URL are right there, which is what robots etiquette actually asks for.
 */
export const USER_AGENT =
  process.env.BTI_USER_AGENT ??
  "Mozilla/5.0 (compatible; biotech-insights/0.2; personal daily digest; +https://github.com/)";

export const FEED_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8";

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  accept?: string;
  etag?: string;
  lastModified?: string;
  crawlDelayMs?: number;
  cacheKey?: string;
  /** Replay from .cache/raw instead of hitting the network. */
  fromCache?: boolean;
}

export interface FetchResult {
  status: number;
  notModified: boolean;
  body?: string;
  etag?: string;
  lastModified?: string;
  finalUrl: string;
  timingMs: number;
  attempts: number;
  fromCache: boolean;
  error?: string;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const limit = createLimiter(6);
const hostGate = createHostGate(250);

export function createHttpClient(cache: HttpCache) {
  return async function fetchWithPolicy(
    url: string,
    options: FetchOptions = {},
  ): Promise<FetchResult> {
    const key = options.cacheKey ?? url;
    const started = Date.now();

    if (options.fromCache) {
      const body = await cache.readRaw(key);
      return {
        status: body ? 200 : 504,
        notModified: false,
        body,
        finalUrl: url,
        timingMs: Date.now() - started,
        attempts: 0,
        fromCache: true,
        error: body ? undefined : "not in cache",
      };
    }

    const host = hostOf(url);
    const retries = options.retries ?? 2;

    return limit(() =>
      hostGate(host, options.crawlDelayMs ?? 250, async () => {
        let lastError = "";
        let lastStatus = 0;

        for (let attempt = 0; attempt <= retries; attempt++) {
          if (attempt > 0) {
            const backoff = Math.min(30_000, 800 * 2 ** attempt);
            await sleep(backoff * (0.5 + Math.random() * 0.5));
          }

          try {
            const headers: Record<string, string> = {
              "user-agent": USER_AGENT,
              accept: options.accept ?? FEED_ACCEPT,
              "accept-language": "en-US,en;q=0.9",
              "accept-encoding": "gzip, deflate, br",
            };
            if (options.etag) headers["if-none-match"] = options.etag;
            if (options.lastModified) headers["if-modified-since"] = options.lastModified;

            const response = await fetch(url, {
              signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
              headers,
              redirect: "follow",
            });

            lastStatus = response.status;

            if (response.status === 304) {
              return {
                status: 304,
                notModified: true,
                finalUrl: response.url || url,
                timingMs: Date.now() - started,
                attempts: attempt + 1,
                fromCache: false,
              };
            }

            if (!response.ok) {
              lastError = `HTTP ${response.status}`;
              if (RETRYABLE.has(response.status) && attempt < retries) {
                const retryAfter = Number(response.headers.get("retry-after"));
                if (Number.isFinite(retryAfter) && retryAfter > 0) {
                  await sleep(Math.min(30_000, retryAfter * 1000));
                }
                continue;
              }
              return {
                status: response.status,
                notModified: false,
                finalUrl: response.url || url,
                timingMs: Date.now() - started,
                attempts: attempt + 1,
                fromCache: false,
                error: lastError,
              };
            }

            const body = await response.text();
            const etag = response.headers.get("etag") ?? undefined;
            const lastModified = response.headers.get("last-modified") ?? undefined;

            cache.set(key, {
              etag,
              lastModified,
              fetchedAt: new Date().toISOString(),
              status: response.status,
              contentHash: contentHash(body),
            });
            await cache.writeRaw(key, body);

            return {
              status: response.status,
              notModified: false,
              body,
              etag,
              lastModified,
              finalUrl: response.url || url,
              timingMs: Date.now() - started,
              attempts: attempt + 1,
              fromCache: false,
            };
          } catch (error) {
            lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            if (attempt >= retries) break;
          }
        }

        return {
          status: lastStatus || 0,
          notModified: false,
          finalUrl: url,
          timingMs: Date.now() - started,
          attempts: retries + 1,
          fromCache: false,
          error: lastError || "fetch failed",
        };
      }),
    );
  };
}

export type HttpClient = ReturnType<typeof createHttpClient>;
