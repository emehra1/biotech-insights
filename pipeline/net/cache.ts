import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Two caches with different lifetimes:
 *
 *  - `.cache/http-meta.json` is COMMITTED. Actions runners are ephemeral, so
 *    without persisted ETag/Last-Modified we would never get a 304 and would
 *    re-download every feed daily. It is one small line per source.
 *  - `.cache/raw/` is gitignored and holds fetched bodies, so `--from-cache`
 *    can replay a run with zero network. That is the main dev ergonomic here:
 *    extraction gets iterated far more often than feeds change.
 */

export interface HttpMetaEntry {
  etag?: string;
  lastModified?: string;
  fetchedAt: string;
  status: number;
  contentHash?: string;
}

export interface HttpMeta {
  version: 1;
  entries: Record<string, HttpMetaEntry>;
}

const EMPTY_META: HttpMeta = { version: 1, entries: {} };

export class HttpCache {
  private meta: HttpMeta = EMPTY_META;
  private dirty = false;

  constructor(
    private readonly metaPath: string,
    private readonly rawDir: string,
  ) {}

  async load(): Promise<void> {
    try {
      const text = await readFile(this.metaPath, "utf8");
      const parsed = JSON.parse(text) as HttpMeta;
      if (parsed && typeof parsed === "object" && parsed.entries) this.meta = parsed;
    } catch {
      this.meta = { version: 1, entries: {} };
    }
  }

  get(key: string): HttpMetaEntry | undefined {
    return this.meta.entries[key];
  }

  set(key: string, entry: HttpMetaEntry): void {
    this.meta.entries[key] = entry;
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(path.dirname(this.metaPath), { recursive: true });
    const sorted: Record<string, HttpMetaEntry> = {};
    for (const key of Object.keys(this.meta.entries).sort()) {
      const entry = this.meta.entries[key];
      if (entry) sorted[key] = entry;
    }
    await writeFile(
      this.metaPath,
      `${JSON.stringify({ version: 1, entries: sorted }, null, 2)}\n`,
      "utf8",
    );
    this.dirty = false;
  }

  private rawPath(key: string): string {
    const safe = createHash("sha256").update(key).digest("hex").slice(0, 20);
    return path.join(this.rawDir, `${safe}.txt`);
  }

  async readRaw(key: string): Promise<string | undefined> {
    try {
      return await readFile(this.rawPath(key), "utf8");
    } catch {
      return undefined;
    }
  }

  async writeRaw(key: string, body: string): Promise<void> {
    await mkdir(this.rawDir, { recursive: true });
    await writeFile(this.rawPath(key), body, "utf8");
  }
}

export function contentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}
