/**
 * The journal allowlist, and the name each journal is credited under.
 *
 * Scope is deliberately closed: Nature, Cell, Science, NEJM, The Lancet, JAMA
 * and bioRxiv/medRxiv, plus their sub-journals. Nothing else. The previous
 * keyword-across-all-of-Europe-PMC source is what put "Computational biology and
 * chemistry" and "Advanced materials (Deerfield Beach, Fla.)" in a biotech
 * digest.
 *
 * Excluded on volume, though they belong to these families: Nature
 * Communications (~80 papers/day), Science Advances (208 records/14d), JAMA
 * Network Open, Cell Reports and Cell Reports Medicine, Current Biology, Cell
 * Systems. Any one of them would spend a source's entire daily allowance before
 * its flagship was reached.
 *
 * Every `JOURNAL:` value here was verified against the live API on 2026-08-07 to
 * resolve to exactly one journal and return a non-zero count over 14 days. That
 * check matters because a wrong value is not an error — Europe PMC answers HTTP
 * 200 with hitCount 0.
 */

/** Europe PMC `JOURNAL:` values, grouped by the family that publishes them. */
export const JOURNAL_FAMILIES = {
  /** Cell Press. cell.com 403s the runner and asserts a TDM opt-out. */
  cellpress: [
    "Cell",
    "Cell Stem Cell",
    "Cell Metab",
    "Cancer Cell",
    "Immunity",
    "Neuron",
    "Mol Cell",
    "Dev Cell",
    "Cell Chem Biol",
    "Cell Host Microbe",
    "Med",
  ],
  /** Lancet family. Also Elsevier, hence the shared publisherGroup. */
  lancet: [
    "Lancet",
    "Lancet Oncol",
    "Lancet Neurol",
    "Lancet Respir Med",
    "Lancet Diabetes Endocrinol",
    "Lancet Infect Dis",
    "Lancet Haematol",
    "Lancet Psychiatry",
  ],
  /** AAAS research. science.org disallows /action in robots.txt. */
  aaas: ["Science", "Sci Transl Med", "Sci Immunol"],
  nejm: ["N Engl J Med"],
  /**
   * JAMA's specialty titles only. JAMA itself is deliberately absent: it has a
   * working RSS feed, and a journal reachable by two routes arrives under two
   * different canonical URLs, which the URL deduper cannot merge.
   */
  jama: [
    "JAMA Oncol",
    "JAMA Cardiol",
    "JAMA Neurol",
    "JAMA Intern Med",
    "JAMA Pediatr",
    "JAMA Psychiatry",
  ],
} as const satisfies Record<string, readonly string[]>;

/**
 * NLM catalogue title → the name a reader recognises.
 *
 * Keys are the title as Europe PMC returns it, after `cleanJournalTitle` has
 * trimmed the disambiguating parenthetical and the post-colon subtitle — so
 * "Lancet (London, England)" arrives here as "lancet", and "The Lancet.
 * Oncology" as "the lancet oncology". Matching is case-insensitive because NLM
 * capitalisation is inconsistent even within one family ("The Lancet.
 * Neurology" but "The lancet. Psychiatry").
 */
const DISPLAY_NAMES: Record<string, string> = {
  // Cell Press
  cell: "Cell",
  "cell stem cell": "Cell Stem Cell",
  "cell metabolism": "Cell Metabolism",
  "cancer cell": "Cancer Cell",
  immunity: "Immunity",
  neuron: "Neuron",
  "molecular cell": "Molecular Cell",
  "developmental cell": "Developmental Cell",
  "cell chemical biology": "Cell Chemical Biology",
  "cell host & microbe": "Cell Host & Microbe",
  med: "Med",
  // Lancet
  lancet: "The Lancet",
  "the lancet oncology": "The Lancet Oncology",
  "the lancet neurology": "The Lancet Neurology",
  "the lancet respiratory medicine": "The Lancet Respiratory Medicine",
  "the lancet diabetes & endocrinology": "The Lancet Diabetes & Endocrinology",
  "the lancet infectious diseases": "The Lancet Infectious Diseases",
  "the lancet haematology": "The Lancet Haematology",
  "the lancet psychiatry": "The Lancet Psychiatry",
  // AAAS
  science: "Science",
  "science translational medicine": "Science Translational Medicine",
  "science immunology": "Science Immunology",
  // NEJM
  "the new england journal of medicine": "New England Journal of Medicine",
  // JAMA
  jama: "JAMA",
  "jama oncology": "JAMA Oncology",
  "jama cardiology": "JAMA Cardiology",
  "jama neurology": "JAMA Neurology",
  "jama internal medicine": "JAMA Internal Medicine",
  "jama pediatrics": "JAMA Pediatrics",
  "jama psychiatry": "JAMA Psychiatry",
  // Springer Nature — reached by RSS, but the aging-and-omics view and any
  // future Europe PMC route would surface these titles too.
  nature: "Nature",
  "nature medicine": "Nature Medicine",
  "nature biotechnology": "Nature Biotechnology",
  "nature genetics": "Nature Genetics",
  "nature aging": "Nature Aging",
  "nature metabolism": "Nature Metabolism",
  "nature cell biology": "Nature Cell Biology",
  "nature cancer": "Nature Cancer",
  "nature chemical biology": "Nature Chemical Biology",
  "nature biomedical engineering": "Nature Biomedical Engineering",
  "nature reviews drug discovery": "Nature Reviews Drug Discovery",
};

/**
 * The journal to credit, given whatever the index called it. Falls back to the
 * catalogue title unchanged — a recognisable-but-unstyled name beats crediting
 * the aggregator.
 */
export function displayJournal(cleanedTitle: string): string {
  return DISPLAY_NAMES[cleanedTitle.toLowerCase()] ?? cleanedTitle;
}
