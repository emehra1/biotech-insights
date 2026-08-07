import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HttpCache } from "../pipeline/net/cache";
import { CookieJar } from "../pipeline/net/cookies";
import { createHttpClient } from "../pipeline/net/http";
import { describeWrongShape } from "../pipeline/net/shape";

/**
 * The jar exists to stop nature.com bouncing every request through
 * idp.nature.com, so the cases that matter are the ones that bounce showed us:
 * a Domain= cookie set on one host and needed on another, HttpOnly/Secure
 * attributes, and the fact that a `Set-Cookie` Expires value contains a comma.
 */
function headers(...setCookie: string[]): Headers {
  const h = new Headers();
  for (const line of setCookie) h.append("set-cookie", line);
  return h;
}

describe("cookie jar", () => {
  it("sends a Domain= cookie back to a sibling subdomain", () => {
    // This is the whole nature.com mechanism: idp.nature.com sets the session
    // on `.nature.com`, and www.nature.com is where it has to arrive.
    const jar = new CookieJar();
    jar.absorb(
      "https://idp.nature.com/authorize",
      headers("idp_session=sVERSION_1abc; Domain=.nature.com; Path=/; Secure; HttpOnly"),
    );
    expect(jar.header("https://www.nature.com/natcancer.rss")).toBe("idp_session=sVERSION_1abc");
  });

  it("keeps a host-only cookie off other subdomains", () => {
    const jar = new CookieJar();
    jar.absorb("https://idp.nature.com/authorize", headers("local=1; Path=/"));
    expect(jar.header("https://www.nature.com/nrd.rss")).toBeUndefined();
    expect(jar.header("https://idp.nature.com/transit")).toBe("local=1");
  });

  it("never leaks a cookie to an unrelated publisher", () => {
    const jar = new CookieJar();
    jar.absorb("https://idp.nature.com/authorize", headers("idp_session=x; Domain=.nature.com"));
    expect(jar.header("https://www.science.org/rss/news_current.xml")).toBeUndefined();
    expect(jar.header("https://evil-nature.com/feed")).toBeUndefined();
  });

  it("refuses a cookie scoped to a registry suffix", () => {
    // A site claiming Domain=.com would otherwise have its cookie sent to every
    // .com publisher we fetch.
    const jar = new CookieJar();
    jar.absorb("https://www.nature.com/nrd.rss", headers("tracker=1; Domain=.com"));
    expect(jar.header("https://www.statnews.com/feed")).toBeUndefined();
    // It is still stored host-only, which is what a browser does.
    expect(jar.header("https://www.nature.com/ng.rss")).toBe("tracker=1");
  });

  it("refuses a cookie for a domain the setter does not belong to", () => {
    const jar = new CookieJar();
    jar.absorb("https://idp.nature.com/authorize", headers("x=1; Domain=.science.org"));
    expect(jar.header("https://www.science.org/feed")).toBeUndefined();
  });

  it("parses multiple Set-Cookie headers whose Expires contains a comma", () => {
    // getSetCookie() is the only correct reader: headers.get("set-cookie")
    // joins on ", " and "Expires=Wed, 09 Jun 2027" already has one.
    const jar = new CookieJar();
    jar.absorb(
      "https://idp.nature.com/authorize",
      headers(
        "idp_marker=17fc; Domain=.nature.com; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; HttpOnly",
        "idp_session=sV1; Domain=.nature.com; Path=/; Secure; HttpOnly",
        "idp_session_http=hV1; Domain=.nature.com; Path=/; HttpOnly",
      ),
    );
    expect(jar.names()).toEqual(["idp_marker", "idp_session", "idp_session_http"]);
    expect(jar.header("https://www.nature.com/nm.rss")).toContain("idp_marker=17fc");
  });

  it("withholds a Secure cookie from a plaintext request", () => {
    const jar = new CookieJar();
    jar.absorb("https://www.nature.com/nrd.rss", headers("s=1; Secure"));
    expect(jar.header("http://www.nature.com/nrd.rss")).toBeUndefined();
    expect(jar.header("https://www.nature.com/nrd.rss")).toBe("s=1");
  });

  it("treats Max-Age=0 as a deletion", () => {
    const jar = new CookieJar();
    jar.absorb("https://www.nature.com/a.rss", headers("s=1; Path=/"));
    expect(jar.header("https://www.nature.com/a.rss")).toBe("s=1");
    jar.absorb("https://www.nature.com/a.rss", headers("s=; Path=/; Max-Age=0"));
    expect(jar.header("https://www.nature.com/a.rss")).toBeUndefined();
  });

  it("lets Max-Age win over an Expires in the past", () => {
    const jar = new CookieJar();
    jar.absorb(
      "https://www.nature.com/a.rss",
      headers("s=1; Path=/; Expires=Wed, 09 Jun 2021 10:18:14 GMT; Max-Age=3600"),
    );
    expect(jar.header("https://www.nature.com/a.rss")).toBe("s=1");
  });

  it("scopes by path", () => {
    const jar = new CookieJar();
    jar.absorb("https://x.test/a/b", headers("deep=1; Path=/a"));
    expect(jar.header("https://x.test/a/other")).toBe("deep=1");
    expect(jar.header("https://x.test/b")).toBeUndefined();
  });

  it("replaces a cookie of the same name and scope rather than duplicating it", () => {
    const jar = new CookieJar();
    jar.absorb("https://x.test/", headers("s=old; Path=/"));
    jar.absorb("https://x.test/", headers("s=new; Path=/"));
    expect(jar.header("https://x.test/")).toBe("s=new");
  });
});

describe("response shape", () => {
  const RDF = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><item/></rdf:RDF>';

  it("accepts the RDF nature.com actually serves", () => {
    expect(describeWrongShape(RDF, "xml")).toBeUndefined();
  });

  it("names an interstitial by its title", () => {
    const challenge = '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>';
    expect(describeWrongShape(challenge, "xml")).toBe(
      'got HTML titled "Just a moment..." — likely a bot challenge or consent page',
    );
  });

  it("catches HTML that opens with a comment or a stray newline", () => {
    expect(describeWrongShape("\n\n  <!DOCTYPE html>\n<html><body>hi</body></html>", "xml")).toMatch(
      /^got HTML/,
    );
  });

  it("reports an empty body as empty, not as malformed markup", () => {
    expect(describeWrongShape("   \n ", "xml")).toBe("got an empty response");
  });

  it("flags JSON served where XML was expected, and the reverse", () => {
    expect(describeWrongShape('{"studies":[]}', "xml")).toBe("got JSON");
    expect(describeWrongShape(RDF, "json")).toBe("got markup, not JSON");
  });

  it("accepts both a JSON object and a JSON array", () => {
    expect(describeWrongShape('{"a":1}', "json")).toBeUndefined();
    expect(describeWrongShape("[1,2]", "json")).toBeUndefined();
  });

  it("quotes the start of a body that is neither", () => {
    expect(describeWrongShape("rate limit exceeded", "xml")).toBe(
      'got non-markup starting "rate limit exceeded"',
    );
  });

  it("stays on one line so it survives a markdown table", () => {
    const multiline = '<!DOCTYPE html>\n<html>\n<head>\n<title>Access\ndenied</title>\n</head>';
    expect(describeWrongShape(multiline, "xml")).not.toContain("\n");
  });
});

/**
 * The redirect follower is new and every one of the 32 sources goes through it,
 * so it gets a real server rather than a mock. These reproduce, in miniature,
 * the exact nature.com chain: a 303 to an identity provider that sets a session
 * cookie and bounces back, where the second visit must carry the cookie and
 * must NOT carry the conditional headers from the first hop.
 */
const RDF = '<rdf:RDF xmlns:rdf="http://x"><item><title>t</title><link>https://e.test/a</link></item></rdf:RDF>';

interface Probe {
  requests: { url: string; headers: IncomingMessage["headers"] }[];
  close: () => Promise<void>;
  origin: string;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse, probe: Probe) => void): Promise<Probe> {
  const probe: Probe = { requests: [], close: async () => {}, origin: "" };
  const server = createServer((req, res) => {
    probe.requests.push({ url: req.url ?? "", headers: req.headers });
    handler(req, res, probe);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  probe.origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return probe;
}

async function withCache<T>(run: (cache: HttpCache) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "bti-net-"));
  try {
    const cache = new HttpCache(path.join(dir, "meta.json"), path.join(dir, "raw"));
    await cache.load();
    return await run(cache);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("redirect following", () => {
  it("carries a cookie set mid-chain back to the origin that bounced us", async () => {
    // The nature.com shape: /feed 303s to /authorize, which sets the session and
    // sends us back; the second /feed must present it or we bounce forever.
    const probe = await serve((req, res) => {
      const cookie = req.headers.cookie ?? "";
      if (req.url?.startsWith("/authorize")) {
        res.writeHead(302, {
          "set-cookie": "idp_session=sV1; Path=/",
          location: "/feed.rss",
        });
        return res.end();
      }
      if (!cookie.includes("idp_session")) {
        res.writeHead(303, { location: "/authorize?redirect_uri=/feed.rss" });
        return res.end("");
      }
      res.writeHead(200, { "content-type": "application/rss+xml" });
      res.end(RDF);
    });

    const result = await withCache((cache) =>
      createHttpClient(cache)(`${probe.origin}/feed.rss`, { expect: "xml", crawlDelayMs: 0 }),
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe(RDF);
    expect(result.redirects).toBe(2);
    // Third request is the retried feed; it must carry what /authorize handed out.
    expect(probe.requests[2]?.headers.cookie).toContain("idp_session=sV1");
  });

  it("drops conditional headers once it has been redirected", async () => {
    // An ETag describes the feed. Forwarding it to the identity provider invites
    // a 304 from a service that has never served the entity we hold.
    const probe = await serve((req, res) => {
      if (req.url === "/feed.rss") {
        res.writeHead(302, { location: "/elsewhere.rss" });
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(RDF);
    });

    await withCache((cache) =>
      createHttpClient(cache)(`${probe.origin}/feed.rss`, {
        expect: "xml",
        crawlDelayMs: 0,
        etag: '"abc"',
        lastModified: "Wed, 09 Jun 2027 10:18:14 GMT",
      }),
    );

    expect(probe.requests[0]?.headers["if-none-match"]).toBe('"abc"');
    expect(probe.requests[1]?.headers["if-none-match"]).toBeUndefined();
    expect(probe.requests[1]?.headers["if-modified-since"]).toBeUndefined();
  });

  it("gives up on a redirect loop instead of hanging", async () => {
    const probe = await serve((_req, res) => {
      res.writeHead(302, { location: "/loop" });
      res.end();
    });

    const result = await withCache((cache) =>
      createHttpClient(cache)(`${probe.origin}/loop`, { expect: "xml", retries: 0, crawlDelayMs: 0 }),
    );

    expect(result.error).toMatch(/too many redirects/);
    expect(probe.requests.length).toBeLessThan(20);
  });
});

describe("soft blocks", () => {
  const CHALLENGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>';

  it("never caches a 200 that carries an interstitial", async () => {
    const probe = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html", etag: '"challenge"' });
      res.end(CHALLENGE);
    });

    await withCache(async (cache) => {
      const result = await createHttpClient(cache)(`${probe.origin}/feed.rss`, {
        cacheKey: "probe",
        expect: "xml",
        retries: 1,
        crawlDelayMs: 0,
      });

      expect(result.status).toBe(200);
      expect(result.body).toBeUndefined();
      expect(result.error).toBe(
        'expected XML, got HTML titled "Just a moment..." — likely a bot challenge or consent page',
      );
      // Neither half of the cache may remember it. A stored ETag is the worse
      // of the two: it survives in the committed http-meta.json and earns a
      // 304 for the challenge page on every later run.
      expect(cache.get("probe")).toBeUndefined();
      expect(await cache.readRaw("probe")).toBeUndefined();
      return result;
    });
  });

  it("purges an entry cached before the shape gate existed", async () => {
    const probe = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(CHALLENGE);
    });

    await withCache(async (cache) => {
      cache.set("probe", { etag: '"stale"', fetchedAt: "2026-08-06T00:00:00Z", status: 200 });
      await cache.writeRaw("probe", CHALLENGE);

      await createHttpClient(cache)(`${probe.origin}/feed.rss`, {
        cacheKey: "probe",
        expect: "xml",
        retries: 0,
        crawlDelayMs: 0,
      });

      expect(cache.get("probe")).toBeUndefined();
      expect(await cache.readRaw("probe")).toBeUndefined();
    });
  });

  it("retries a soft block, and keeps the body when the retry succeeds", async () => {
    // The realistic case: the first attempt is challenged, and the attempt after
    // it carries the session that challenge handed out.
    let hits = 0;
    const probe = await serve((_req, res) => {
      if (hits++ === 0) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(CHALLENGE);
      }
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(RDF);
    });

    const result = await withCache((cache) =>
      createHttpClient(cache)(`${probe.origin}/feed.rss`, {
        expect: "xml",
        retries: 2,
        crawlDelayMs: 0,
      }),
    );

    expect(result.body).toBe(RDF);
    expect(result.attempts).toBe(2);
  });

  it("stops retrying a host that has already proven it is blocking", async () => {
    const probe = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(CHALLENGE);
    });

    await withCache(async (cache) => {
      const http = createHttpClient(cache);
      // First source spends its whole budget establishing the host is refusing.
      await http(`${probe.origin}/one.rss`, { expect: "xml", retries: 2, crawlDelayMs: 0 });
      const spent = probe.requests.length;
      expect(spent).toBe(3);

      // Every source after it fails on the first attempt instead of tripling
      // the load on a host that is already saying no.
      await http(`${probe.origin}/two.rss`, { expect: "xml", retries: 2, crawlDelayMs: 0 });
      expect(probe.requests.length - spent).toBe(1);
    });
  });

  it("leaves a JSON source alone — the check is per dialect, not global", async () => {
    // Gating on "looks like XML" would stop caching all six JSON sources and
    // silently break --from-cache and conditional GET for them.
    const probe = await serve((_req, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: '"j"' });
      res.end('{"studies":[]}');
    });

    await withCache(async (cache) => {
      const result = await createHttpClient(cache)(`${probe.origin}/api`, {
        cacheKey: "trials",
        expect: "json",
        crawlDelayMs: 0,
      });
      expect(result.body).toBe('{"studies":[]}');
      expect(cache.get("trials")?.etag).toBe('"j"');
    });
  });
});
