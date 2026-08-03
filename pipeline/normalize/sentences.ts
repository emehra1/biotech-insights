/**
 * Sentence splitting via Intl.Segmenter (ships with Node — no dependency).
 *
 * Verified behavior: "(HR 0.94, p=0.31; n=6,000)" stays inside one sentence,
 * which matters because those are exactly the sentences we want to select.
 * Segmenter still splits on abbreviations, so we re-join known ones.
 */

const ABBREVIATIONS = [
  "dr", "mr", "mrs", "ms", "prof", "st", "vs", "etc", "inc", "corp", "ltd",
  "co", "llc", "plc", "ag", "nv", "sa", "jr", "sr", "approx", "est", "fig",
  "figs", "eq", "ref", "no", "vol", "ed", "eds", "al", "ca", "cf", "e.g",
  "i.e", "u.s", "u.k", "e.u", "ph.d", "m.d", "b.s", "m.s", "mg", "kg", "ml",
];

const ABBREV_RE = new RegExp(
  `(^|[\\s(])(${ABBREVIATIONS.map((a) => a.replace(/\./g, "\\.")).join("|")})\\.$`,
  "i",
);

/** True when a fragment ends in an abbreviation, i.e. the split was spurious. */
function endsWithAbbreviation(fragment: string): boolean {
  const tail = fragment.trimEnd();
  if (ABBREV_RE.test(tail)) return true;
  // A single capital + period ("J. Smith") or a lone digit + period ("1.").
  return /(^|[\s(])[A-Z]\.$/.test(tail) || /(^|\s)\d{1,3}\.$/.test(tail);
}

export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const raw = [...segmenter.segment(clean)].map((s) => s.segment.trim()).filter(Boolean);

  const merged: string[] = [];
  for (const fragment of raw) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && endsWithAbbreviation(previous)) {
      merged[merged.length - 1] = `${previous} ${fragment}`;
      continue;
    }
    merged.push(fragment);
  }

  return merged;
}

export function wordCount(sentence: string): number {
  return sentence.split(/\s+/).filter(Boolean).length;
}
