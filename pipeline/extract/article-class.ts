import type { ArticleClass } from "../../lib/types";

/**
 * What kind of thing a journal feed actually handed us.
 *
 * nature.rss is a magazine and a journal sharing one feed. A live pull returned
 * 150 items: 88 carried a `d41586` DOI and 62 carried `s41586`. Springer Nature
 * encodes the split in the identifier itself — `d` for newsroom content (news,
 * features, Correspondence, Careers, book reviews, even the Futures fiction
 * column), `s` for the journal proper — and it is the only reliable signal in
 * the feed, because both arrive with byte-identical markup.
 *
 * Without this, "it appeared in Nature" was worth a flat +13.5 to every item
 * from a major journal, so "Science-backed tips on how to avoid distractions"
 * and "The recovered notes of Professor Alborough" were scored as landmark
 * papers — and outranked the actual papers, because a short teaser and a real
 * abstract get the same authority credit.
 *
 * The classifier is deliberately conservative: anything it cannot place stays
 * `unknown` and keeps its existing treatment. JAMA, Cell and NEJM expose no
 * article-type signal in their URLs at all, and guessing at those would trade a
 * known false positive for an unknown false negative.
 */

/** Corrections, errata, retraction notices. Never a recommendation. */
const NOTICE_TITLE =
  /^\s*(?:author correction|publisher correction|correction|corrigend(?:um|a)|erratum|errata|retraction note|retracted article|withdrawn|(?:editorial )?expression of concern|addendum)\b/i;

/**
 * Journal front matter. These carry research DOIs but are not research: an
 * "Editor's pick" ran three days straight in the digest, and Matters Arising /
 * Reply-to pairs are correspondence about a paper, not the paper.
 */
const FRONT_MATTER_TITLE =
  /^\s*(?:editor(?:'|’)s pick|editorial|in this issue|this month in|books? (?:in brief|and arts)|book review|career (?:column|feature|guide)|where i work|obituary|correspondence|news\s*(?:&|and)\s*views|matters arising|reply to|comment on|author response)\b/i;

/** Springer Nature newsroom identifiers: 10.1038/d41586-026-02339-1. */
const SPRINGER_MAGAZINE = /(?:^|[/:])d\d{5}-\d{2,4}-/;
/** Springer Nature journal identifiers: 10.1038/s41591-026-04543-y. */
const SPRINGER_JOURNAL = /(?:^|[/:])s\d{5}-\d{2,4}-/;

/**
 * Newsroom paths. science.org serves research at /doi/10.1126/… and news at
 * /content/article/… — the whole `science-news` feed is the latter, which is
 * why it never should have been counted as a research journal.
 */
const NEWS_PATH = /\/(?:content\/article|news|newsroom|careers|blogs?|podcasts?|opinion)\//i;

export interface ArticleClassInput {
  title: string;
  url: string;
  doi?: string;
}

export function classifyArticle(input: ArticleClassInput): ArticleClass {
  if (NOTICE_TITLE.test(input.title)) return "notice";

  // The identifier beats the title: a `d41586` item is newsroom content whatever
  // it calls itself.
  const locator = `${input.doi ?? ""} ${input.url}`;
  if (SPRINGER_MAGAZINE.test(locator)) return "news-comment";
  if (FRONT_MATTER_TITLE.test(input.title)) return "news-comment";
  if (NEWS_PATH.test(input.url)) return "news-comment";
  if (SPRINGER_JOURNAL.test(locator)) return "research";

  return "unknown";
}

/**
 * Whether a major-journal item earns the `major-journal-primary` event boost.
 * Phrased as "not disqualified" rather than "is research" on purpose: sources
 * whose URLs carry no article-type signal keep the boost they have always had,
 * so this change can only remove points from items that provably do not deserve
 * them.
 */
export function earnsMajorJournalBoost(articleClass: ArticleClass): boolean {
  return articleClass !== "news-comment" && articleClass !== "notice";
}
