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

/**
 * The sentence containing `index`, for quoting evidence.
 *
 * Must not treat the period in "HR 0.94" or "p=0.31" as a boundary — a naive
 * lastIndexOf(".") returns the 8-character fragment " p=0.31)" instead of the
 * sentence, which makes the evidence quote useless.
 */
export function sentenceAround(text: string, index: number, maxChars = 260): string {
  const boundary = /[.!?](?=\s|$)/g;
  let start = 0;
  let end = text.length;

  for (const match of text.matchAll(boundary)) {
    if (match.index === undefined) continue;
    if (match.index < index) start = match.index + 1;
    else {
      end = match.index + 1;
      break;
    }
  }

  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, maxChars);
}
