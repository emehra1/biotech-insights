/**
 * "Is this body the kind of thing we asked for?"
 *
 * One definition, used in two places that must agree:
 *
 *  - `http.ts` calls it BEFORE writing to the cache, so a bot challenge or an
 *    IdP interstitial can never be stored as if it were a feed. That is not
 *    hypothetical: a 200-with-HTML for nature-rev-drug-discovery was cached
 *    along with its ETag, and the next run's conditional request earned an
 *    honest 304 and replayed the HTML back out of the cache. The source failed
 *    with "HTTP 304 · expected XML, got HTML" — a fetch that never happened.
 *
 *  - `collect.ts` calls it to explain the failure, because the alternative
 *    message is the XML parser's "Attribute without value, Line: 13" (HTML
 *    boolean attributes like `<script async>` are illegal in XML), which tells
 *    you nothing about what to do next.
 */

export type BodyShape = "xml" | "json";

/**
 * Returns a human description when the body is NOT what `expect` asked for, or
 * undefined when it looks right. Kept to a single line so it survives a
 * markdown table in the job summary.
 */
export function describeWrongShape(body: string, expect: BodyShape): string | undefined {
  const head = body.slice(0, 400).trim();
  if (!head) return "got an empty response";

  const lower = head.toLowerCase();

  if (expect === "json") {
    if (lower.startsWith("{") || lower.startsWith("[")) return undefined;
    if (lower.startsWith("<!doctype html") || lower.startsWith("<html")) {
      return `got HTML${titleOf(head)} — likely a bot challenge or consent page`;
    }
    if (head.startsWith("<")) return "got markup, not JSON";
    return `got non-JSON starting ${JSON.stringify(head.slice(0, 40))}`;
  }

  if (lower.startsWith("<!doctype html") || lower.startsWith("<html") || lower.includes("<head>")) {
    return `got HTML${titleOf(head)} — likely a bot challenge or consent page`;
  }
  if (lower.startsWith("{") || lower.startsWith("[")) return "got JSON";
  if (!head.startsWith("<")) {
    return `got non-markup starting ${JSON.stringify(head.slice(0, 40))}`;
  }
  return undefined;
}

function titleOf(head: string): string {
  // Collapse whitespace, don't just trim it. A `<title>` wrapped across two
  // lines would otherwise put a newline into the health table's detail column,
  // and a newline inside a markdown table cell shatters the row into fake ones.
  const title = /<title[^>]*>([^<]{0,80})/i.exec(head)?.[1]?.replace(/\s+/g, " ").trim();
  return title ? ` titled "${title}"` : "";
}
