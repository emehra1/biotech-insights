import type { FocusLane } from "../../lib/types";

/**
 * Per-lane lexicons. Weighted terms, not a flat keyword list: the old
 * implementation counted substring hits with a threshold of 1, so every item
 * landed in every category. Here each term contributes its weight, the total
 * saturates, and an item gets one primary lane plus secondary tags.
 */

export interface LaneTerm {
  /** Matched case-insensitively as a whole word/phrase. */
  term: string;
  weight: number;
}

export const LANE_LEXICONS: Record<FocusLane, LaneTerm[]> = {
  "clinical-regulatory": [
    { term: "phase 3", weight: 3 },
    { term: "phase iii", weight: 3 },
    { term: "phase 2", weight: 2 },
    { term: "phase 1", weight: 1.5 },
    { term: "primary endpoint", weight: 3 },
    { term: "topline", weight: 3 },
    { term: "readout", weight: 2.5 },
    { term: "fda", weight: 3 },
    { term: "ema", weight: 2 },
    { term: "approval", weight: 3 },
    { term: "approved", weight: 2.5 },
    { term: "complete response letter", weight: 3.5 },
    { term: "advisory committee", weight: 3 },
    { term: "adcomm", weight: 3 },
    { term: "pdufa", weight: 3 },
    { term: "priority review", weight: 2.5 },
    { term: "breakthrough therapy", weight: 2.5 },
    { term: "orphan drug", weight: 2 },
    { term: "clinical hold", weight: 3 },
    { term: "adverse event", weight: 2 },
    { term: "safety signal", weight: 2.5 },
    { term: "randomized", weight: 1.5 },
    { term: "placebo", weight: 1.5 },
    { term: "overall survival", weight: 2.5 },
    { term: "progression-free survival", weight: 2.5 },
    { term: "objective response", weight: 2 },
    { term: "biosimilar", weight: 1.5 },
    { term: "label expansion", weight: 2 },
    { term: "recall", weight: 1.5 },
    { term: "trial", weight: 1 },
    { term: "patients", weight: 0.75 },
    { term: "nct", weight: 1.5 },
  ],
  "business-deals": [
    { term: "acquire", weight: 3 },
    { term: "acquisition", weight: 3 },
    { term: "merger", weight: 3.5 },
    { term: "takeover", weight: 3 },
    { term: "buyout", weight: 3 },
    { term: "definitive agreement", weight: 3 },
    { term: "licensing", weight: 2.5 },
    { term: "license agreement", weight: 2.5 },
    { term: "collaboration", weight: 1.5 },
    { term: "upfront", weight: 2.5 },
    { term: "milestone", weight: 2 },
    { term: "royalty", weight: 2 },
    { term: "series a", weight: 2.5 },
    { term: "series b", weight: 2.5 },
    { term: "series c", weight: 2.5 },
    { term: "seed round", weight: 2 },
    { term: "ipo", weight: 3 },
    { term: "initial public offering", weight: 3 },
    { term: "raised", weight: 1.5 },
    { term: "financing", weight: 2 },
    { term: "valuation", weight: 2 },
    { term: "layoffs", weight: 2.5 },
    { term: "restructuring", weight: 2.5 },
    { term: "chapter 11", weight: 3 },
    { term: "winding down", weight: 2.5 },
    { term: "chief executive", weight: 1.5 },
    { term: "ceo", weight: 1.5 },
    { term: "earnings", weight: 1.5 },
    { term: "guidance", weight: 1 },
    { term: "billion", weight: 1.5 },
    { term: "million", weight: 0.75 },
    { term: "stake", weight: 1.5 },
  ],
  "frontier-science": [
    { term: "mechanism", weight: 2 },
    { term: "novel target", weight: 3 },
    { term: "first-in-class", weight: 3 },
    { term: "crispr", weight: 3 },
    { term: "base editing", weight: 3 },
    { term: "prime editing", weight: 3 },
    { term: "gene therapy", weight: 2.5 },
    { term: "gene editing", weight: 2.5 },
    { term: "car-t", weight: 2.5 },
    { term: "antibody-drug conjugate", weight: 2.5 },
    { term: "bispecific", weight: 2.5 },
    { term: "sirna", weight: 2.5 },
    { term: "antisense", weight: 2.5 },
    { term: "mrna", weight: 2 },
    { term: "protac", weight: 3 },
    { term: "molecular glue", weight: 3 },
    { term: "degrader", weight: 2.5 },
    { term: "structural biology", weight: 2 },
    { term: "cryo-em", weight: 2.5 },
    { term: "protein structure", weight: 2 },
    { term: "organoid", weight: 2 },
    { term: "in vivo", weight: 1.5 },
    { term: "preclinical", weight: 1.5 },
    { term: "immunotherapy", weight: 2 },
    { term: "microbiome", weight: 2 },
    { term: "neurodegeneration", weight: 2 },
    { term: "biomarker", weight: 1.5 },
    { term: "pathway", weight: 1 },
    { term: "nature", weight: 1 },
    { term: "science", weight: 0.75 },
    { term: "cell", weight: 0.75 },
    { term: "preprint", weight: 1 },
  ],
  "aging-omics": [
    { term: "aging", weight: 3 },
    { term: "ageing", weight: 3 },
    { term: "longevity", weight: 3 },
    { term: "healthspan", weight: 3 },
    { term: "lifespan", weight: 2.5 },
    { term: "senescence", weight: 3.5 },
    { term: "senolytic", weight: 3.5 },
    { term: "epigenetic clock", weight: 4 },
    { term: "biological age", weight: 3.5 },
    { term: "dna methylation", weight: 3 },
    { term: "methylation age", weight: 3.5 },
    { term: "epigenetic reprogramming", weight: 3.5 },
    { term: "partial reprogramming", weight: 3.5 },
    { term: "yamanaka", weight: 3.5 },
    { term: "ipsc", weight: 2 },
    { term: "geroscience", weight: 3.5 },
    { term: "rapamycin", weight: 2.5 },
    { term: "metformin", weight: 2 },
    { term: "nad+", weight: 2.5 },
    { term: "sirtuin", weight: 3 },
    { term: "mitochondrial dysfunction", weight: 2.5 },
    { term: "proteostasis", weight: 2.5 },
    { term: "autophagy", weight: 2.5 },
    { term: "telomere", weight: 3 },
    { term: "3d genome", weight: 4 },
    { term: "chromatin architecture", weight: 3.5 },
    { term: "chromatin", weight: 2 },
    { term: "hi-c", weight: 3 },
    { term: "topologically associating domain", weight: 4 },
    { term: "enhancer", weight: 2 },
    { term: "single-cell", weight: 3 },
    { term: "single cell", weight: 3 },
    { term: "scrna-seq", weight: 3 },
    { term: "spatial transcriptomics", weight: 3.5 },
    { term: "spatial omics", weight: 3.5 },
    { term: "multiomics", weight: 3 },
    { term: "proteomics", weight: 2.5 },
    { term: "metabolomics", weight: 2.5 },
    { term: "atac-seq", weight: 3 },
    { term: "cell atlas", weight: 3 },
    { term: "clonal hematopoiesis", weight: 3 },
    { term: "stem cell", weight: 2 },
    { term: "regenerative medicine", weight: 2.5 },
  ],
};

/**
 * Journals whose primary research papers deserve an event boost.
 *
 * "Primary research" is enforced, not assumed — see
 * pipeline/extract/article-class.ts. Membership here only makes an item
 * *eligible* for the boost; a Nature News item or an Author Correction is in one
 * of these feeds and still does not get it.
 *
 * `science-news` is deliberately absent. It is science.org's newsroom feed and
 * carries no papers at all, so it collected a landmark-paper boost for items like
 * "Astrophysicists find best evidence yet that galaxies get some spin before
 * birth". Science research now arrives via europepmc-aaas.
 *
 * cell / cell-stem-cell / nejm are kept for the local-only runs where their
 * direct feeds work; in CI their coverage comes from the europepmc-* entries.
 */
export const MAJOR_JOURNAL_SOURCES = new Set([
  "nature",
  "nature-medicine",
  "nature-biotech",
  "nature-genetics",
  "nature-aging",
  "jama",
  "cell",
  "cell-stem-cell",
  "nejm",
  "europepmc-cellpress",
  "europepmc-lancet",
  "europepmc-aaas",
  "europepmc-nejm",
  "europepmc-jama",
]);
