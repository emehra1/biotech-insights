import Parser from "rss-parser";

import type { BodyProvenance } from "../../lib/types";
import { parseFeedDate } from "../normalize/dates";
import { cleanTitleMarkup, htmlToText, stripJournalBoilerplate } from "../normalize/html";
import { canonicalizeUrl, extractDoi } from "../normalize/url";
import { cleanText, squish, truncateWords } from "../normalize/text";
import type { RawFeedItem, SourceDef } from "../config/sources";
import type { IngestResult, NormalizedItem } from "./types";

/**
 * Feed parsing. We hand rss-parser a string we fetched ourselves — never
 * `parseURL`, which hung >120s in testing and 403s on endpoints.news.
 */
const parser: Parser<Record<string, unknown>, RawFeedItem> = new Parser({
  customFields: {
    item: [
      ["content:encoded", "ce"],
      ["dc:date", "dcDate"],
      ["dc:creator", "dcCreator"],
      ["prism:publicationDate", "prismDate"],
      ["prism:doi", "doi"],
      ["description", "rawDescription"],
    ],
  },
});

const NCT_RE = /\bNCT\s?0?\d{7,8}\b/gi;

/** Body text, in order of preference, with the origin recorded honestly. */
function pickBody(
  raw: RawFeedItem,
  source: SourceDef,
): { text: string; provenance: BodyProvenance } {
  const encoded = cleanText(raw.ce);
  if (encoded) {
    const text = source.kind === "journal" || source.kind === "preprint"
      ? stripJournalBoilerplate(htmlToText(encoded))
      : htmlToText(encoded);
    if (text.length > 40) return { text, provenance: "content:encoded" };
  }

  const description = cleanText(raw.rawDescription ?? raw.contentSnippet ?? raw.content);
  if (description) {
    const text = source.kind === "journal" || source.kind === "preprint"
      ? stripJournalBoilerplate(htmlToText(description))
      : htmlToText(description);
    // Short bodies are deks, not articles. Say so rather than implying more.
    if (text.length > 0) {
      return { text, provenance: text.length >= 400 ? "description" : "dek" };
    }
  }

  return { text: "", provenance: "none" };
}

function pickDate(raw: RawFeedItem, source: SourceDef, now: Date) {
  if (source.parser?.date) return source.parser.date(raw, source, now);

  const zone = source.timeZone ?? "UTC";
  const candidates: unknown[] = [raw.isoDate, raw.pubDate, raw.dcDate, raw.prismDate];
  for (const candidate of candidates) {
    if (candidate == null || candidate === "") continue;
    const parsed = parseFeedDate(candidate, { assumeTimeZone: zone, now });
    if (parsed.date) return parsed;
  }
  return parseFeedDate(undefined);
}

function isExcluded(source: SourceDef, url: string, title: string): boolean {
  const exclude = source.exclude;
  if (!exclude) return false;
  if (exclude.urlPatterns?.some((re) => re.test(url))) return true;
  if (exclude.titlePatterns?.some((re) => re.test(title))) return true;
  return false;
}

export async function parseFeed(
  xml: string,
  source: SourceDef,
  now: Date,
): Promise<IngestResult> {
  const warnings: string[] = [];
  const feed = await parser.parseString(xml);
  const rawItems = (feed.items ?? []) as RawFeedItem[];
  const items: NormalizedItem[] = [];

  let unparseableDates = 0;
  let objectTitles = 0;

  for (const raw of rawItems.slice(0, source.maxItems)) {
    if (raw.title != null && typeof raw.title !== "string") objectTitles++;

    const title = squish(
      cleanTitleMarkup(source.parser?.title ? source.parser.title(raw) : cleanText(raw.title)),
    );
    const link = squish(source.parser?.link ? source.parser.link(raw) : cleanText(raw.link));

    if (!title || !link) continue;
    if (isExcluded(source, link, title)) continue;

    const canonicalUrl = canonicalizeUrl(link);
    if (!canonicalUrl) continue;

    const date = pickDate(raw, source, now);
    if (!date.date) unparseableDates++;
    if (date.warning) warnings.push(date.warning);

    const body = pickBody(raw, source);
    const paywalled = source.paywalled || /^\s*STAT\+:/i.test(title);
    const cleanTitle = title.replace(/^\s*STAT\+:\s*/i, "");

    const categories = Array.isArray(raw.categories)
      ? raw.categories.map((c) => cleanText(c)).filter(Boolean)
      : [];
    const creator = cleanText(raw.dcCreator ?? raw.creator);

    const nctIds = [...new Set((`${cleanTitle} ${body.text}`.match(NCT_RE) ?? []).map((n) => n.replace(/\s/g, "").toUpperCase()))];

    items.push({
      sourceId: source.id,
      sourceName: source.name,
      publisherGroup: source.publisherGroup,
      sourceKind: source.kind,
      authority: source.authority,
      laneHints: source.laneHints,
      paywalled,

      title: cleanTitle,
      url: link,
      canonicalUrl,
      guid: cleanText(raw.guid) || undefined,

      publishedAt: date.date ?? undefined,
      datePrecision: date.precision,
      dateConfident: date.confident,

      bodyText: truncateWords(body.text, 6000),
      bodyProvenance: body.provenance,

      categories,
      authors: creator ? [creator] : [],
      doi: cleanText(raw.doi) || extractDoi(`${link} ${body.text}`),
      nctIds,
      warnings: [],
    });
  }

  if (objectTitles > 0) warnings.push(`title-was-object:${objectTitles}`);
  if (unparseableDates > 0) warnings.push(`unparseable-date:${unparseableDates}`);

  return { items, parsed: rawItems.length, warnings };
}
