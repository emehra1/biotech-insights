import { decodeEntities, squish } from "./text";

/**
 * HTML → plain text for feed bodies.
 *
 * BioPharma Dive's <description> is escaped HTML that opens with a
 * <figure><img …></figure> block, so a naive strip yields a leading image URL.
 * Block-level tags must also become spaces, not nothing, or words glue together
 * across paragraph boundaries ("...endpoint.Analysts had tipped...").
 */

const BLOCK_TAGS =
  /<\/?(p|div|br|li|ul|ol|h[1-6]|table|tr|td|th|section|article|figure|figcaption|blockquote|pre|hr|header|footer|aside|nav)\b[^>]*>/gi;

const DROP_ELEMENTS =
  /<(script|style|noscript|iframe|figure|figcaption|form|svg|picture|video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi;

const SELF_CLOSING_DROP = /<(img|source|track|input|link|meta)\b[^>]*\/?>/gi;

export function htmlToText(input: string): string {
  if (!input) return "";
  let text = input;

  // Feeds often double-escape; decode first so tag stripping actually sees tags.
  if (text.includes("&lt;") || text.includes("&gt;")) text = decodeEntities(text);

  text = text.replace(DROP_ELEMENTS, " ");
  text = text.replace(SELF_CLOSING_DROP, " ");
  text = text.replace(BLOCK_TAGS, " \n ");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);

  return squish(text);
}

/**
 * Journal feeds prepend publication boilerplate to content:encoded, e.g.
 * "Nature, Published online: 03 August 2026; doi:10.1038/…". Strip it so the
 * teaser is what remains.
 */
export function stripJournalBoilerplate(input: string): string {
  return squish(
    input
      .replace(
        /^\s*(Nature|Nature\s+[A-Za-z ]+|Science|Cell|Cell\s+[A-Za-z ]+)\s*,?\s*(Published online|Advance online publication|Available online)[^;]*;?\s*/i,
        "",
      )
      .replace(/^\s*doi:\s*10\.\d{4,9}\/\S+\s*/i, "")
      .replace(/\s*doi:\s*10\.\d{4,9}\/\S+\s*$/i, ""),
  );
}

/** Boilerplate lines that are never worth summarizing. */
const BOILERPLATE_LINE =
  /^(sign up|subscribe|read more|continue reading|follow us|share this|editor'?s note|this article|photo|image|credit|advertisement|©|all rights reserved|get the latest|listen to|watch:)/i;

export function isBoilerplateLine(line: string): boolean {
  return BOILERPLATE_LINE.test(line.trim());
}
