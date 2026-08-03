/**
 * `basePath` rewrites framework-generated URLs but not raw strings, so every
 * hand-written link and every client-side fetch has to go through here.
 */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

export function withBase(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${normalized}`;
}

/**
 * GitHub Pages sets a ~10-minute Cache-Control we cannot override, so a fresh
 * deploy's JSON would keep serving stale for that long. The build id query is
 * what actually busts it.
 */
export function dataUrl(path: string): string {
  return `${withBase(path)}?v=${BUILD_ID}`;
}

export const routes = {
  home: () => withBase("/"),
  digest: (date: string) => withBase(`/digest/${date}/`),
  archive: () => withBase("/archive/"),
  weekly: (week: string) => withBase(`/weekly/${week}/`),
  sources: () => withBase("/sources/"),
  watchlist: () => withBase("/watchlist/"),
};
