/**
 * Hand-maintained lexicons. With no LLM, these files *are* the intelligence —
 * budget five minutes a week promoting terms from data/unknown-entities.json
 * or the digest will quietly lose recall as companies rebrand and INNs appear.
 */

/* ------------------------------ drug names ------------------------------- */

/**
 * WHO INN stems. `minLen` exists because short suffixes like -cel and -sen
 * match ordinary English ("cancel", "unseen"); requiring length plus an anchor
 * is what keeps precision up.
 */
export interface InnStem {
  stem: RegExp;
  klass: string;
  minLen: number;
}

export const INN_STEMS: InnStem[] = [
  { stem: /(zumab|ximab|umab|omab|mab)$/, klass: "monoclonal antibody", minLen: 7 },
  { stem: /(ciclib)$/, klass: "CDK inhibitor", minLen: 8 },
  { stem: /(parib)$/, klass: "PARP inhibitor", minLen: 8 },
  { stem: /(rafenib|metinib|tinib|nib)$/, klass: "kinase inhibitor", minLen: 7 },
  { stem: /(zomib)$/, klass: "proteasome inhibitor", minLen: 8 },
  { stem: /(lisib)$/, klass: "PI3K inhibitor", minLen: 8 },
  { stem: /(limus)$/, klass: "mTOR inhibitor", minLen: 8 },
  { stem: /(glutide)$/, klass: "GLP-1 peptide", minLen: 9 },
  { stem: /(tide)$/, klass: "peptide", minLen: 9 },
  { stem: /(gliflozin)$/, klass: "SGLT2 inhibitor", minLen: 10 },
  { stem: /(gliptin)$/, klass: "DPP-4 inhibitor", minLen: 9 },
  { stem: /(siran)$/, klass: "siRNA", minLen: 8 },
  { stem: /(rsen)$/, klass: "antisense oligonucleotide", minLen: 8 },
  { stem: /(vec)$/, klass: "gene therapy", minLen: 9 },
  { stem: /(cel)$/, klass: "cell therapy", minLen: 9 },
  { stem: /(cept)$/, klass: "fusion protein", minLen: 8 },
  { stem: /(kin)$/, klass: "cytokine", minLen: 9 },
  { stem: /(xaban)$/, klass: "factor Xa inhibitor", minLen: 8 },
  { stem: /(sartan)$/, klass: "angiotensin receptor blocker", minLen: 8 },
  { stem: /(caftor)$/, klass: "CFTR modulator", minLen: 8 },
  { stem: /(vaptan)$/, klass: "vasopressin antagonist", minLen: 8 },
  { stem: /(statin)$/, klass: "statin", minLen: 8 },
  { stem: /(prazole)$/, klass: "proton pump inhibitor", minLen: 9 },
  { stem: /(dustat|triazole)$/, klass: "small molecule", minLen: 9 },
  { stem: /(ostat|stat)$/, klass: "enzyme inhibitor", minLen: 9 },
  { stem: /(afenib)$/, klass: "kinase inhibitor", minLen: 8 },
  { stem: /(tocinib|citinib)$/, klass: "JAK inhibitor", minLen: 8 },
  { stem: /(degib)$/, klass: "hedgehog inhibitor", minLen: 8 },
  { stem: /(ciguat)$/, klass: "sGC stimulator", minLen: 8 },
  { stem: /(gene)$/, klass: "gene therapy", minLen: 10 },
];

/** ADC payload second-words: very high precision, worth matching directly. */
export const ADC_PAYLOADS =
  /\b(vedotin|deruxtecan|govitecan|emtansine|mafodotin|tirumotecan|ozogamicin|tesirine|nadotameran|duocarmazine|soravtansine)\b/gi;

/**
 * Words that satisfy an INN stem but are ordinary English. Without this list
 * the -stat/-tide/-cel/-kin stems turn "candidate", "cancel" and "protein"
 * into drugs — which is exactly what the previous implementation did.
 */
export const INN_FALSE_POSITIVES = new Set([
  "activate", "candidate", "update", "mandate", "validate", "translate",
  "estimate", "cancel", "parcel", "chosen", "unseen", "dissent", "present",
  "consent", "forecast", "invest", "request", "contrast", "database",
  "increase", "decrease", "disease", "release", "purchase", "protease",
  "kinase", "nuclease", "polymerase", "protein", "prevent", "percent",
  "patient", "incentive", "executive", "negative", "positive", "narrative",
  "initiative", "alternative", "outcome", "genome", "welcome", "become",
  "medicine", "vaccine", "machine", "routine", "baseline", "guideline",
  "pipeline", "timeline", "deadline", "headline", "decline", "combine",
  "determine", "examine", "imagine", "obtained", "sustained", "maintained",
  "provide", "divide", "outside", "alongside", "worldwide", "nationwide",
  "substantial", "potential", "essential", "sequential", "material",
  "interim", "maximum", "minimum", "spectrum", "platform", "algorithm",
  "cellular", "molecular", "particle", "article", "principle", "obstacle",
  "excel", "channel", "personnel", "novel", "level", "model", "panel",
  "protocol", "control", "signal", "capital", "hospital", "digital",
  "biomarker", "marker", "target", "budget", "market", "project",
]);

/** Prefixes that look like development codes but aren't. */
export const CODE_PREFIX_BLOCKLIST = new Set([
  "NCT", "ISO", "ICD", "CPT", "USD", "EUR", "GBP", "CHF", "JPY", "GMT", "EST",
  "EDT", "PST", "PDT", "PDF", "HTML", "RSS", "COVID", "SARS", "FDA", "EMA",
  "NIH", "CDC", "WHO", "NHS", "MHRA", "PMDA", "NMPA", "HR", "CI", "OS", "PFS",
  "ORR", "DOR", "AE", "SAE", "TRAE", "IPO", "CEO", "CFO", "COO", "CSO", "CMO",
  "Q1", "Q2", "Q3", "Q4", "H1", "H2", "FY", "S1", "K1", "IL", "TNF", "PD",
  "US", "UK", "EU", "UN", "AI", "ML", "RNA", "DNA", "PCR", "MRI", "CT", "PET",
]);

/** Two-letter code prefixes that ARE real sponsor codes (LY2157299 etc.). */
export const SPONSOR_CODES = new Set([
  "LY", "MK", "PF", "RO", "DS", "BI", "GS", "VX", "CC", "TA", "AB", "JJ",
  "BG", "KP", "SB", "TQ", "HS", "IB", "ZW", "AZ", "GB", "NN", "SR", "UX",
]);

/* -------------------------------- companies ------------------------------- */

export interface CompanyEntry {
  id: string;
  name: string;
  aliases: string[];
  ticker?: string;
  /** Same group = same newsroom/parent for corroboration purposes. */
  group?: string;
}

/**
 * Curated majors and frequently-covered mid-caps. The suffix-morphology matcher
 * in extract/entities.ts catches the long tail ("Foo Therapeutics") without a
 * dictionary entry, so this only needs names that carry no corporate suffix.
 */
export const COMPANIES: CompanyEntry[] = [
  { id: "pfizer", name: "Pfizer", aliases: ["Pfizer"], ticker: "PFE" },
  { id: "merck", name: "Merck", aliases: ["Merck & Co", "Merck and Co", "MSD"], ticker: "MRK" },
  { id: "merck-kgaa", name: "Merck KGaA", aliases: ["Merck KGaA", "EMD Serono"] },
  { id: "roche", name: "Roche", aliases: ["Roche", "Hoffmann-La Roche"], ticker: "RHHBY" },
  { id: "genentech", name: "Genentech", aliases: ["Genentech"], group: "roche" },
  { id: "novartis", name: "Novartis", aliases: ["Novartis"], ticker: "NVS" },
  { id: "astrazeneca", name: "AstraZeneca", aliases: ["AstraZeneca", "Astra Zeneca"], ticker: "AZN" },
  { id: "gsk", name: "GSK", aliases: ["GSK", "GlaxoSmithKline"], ticker: "GSK" },
  { id: "sanofi", name: "Sanofi", aliases: ["Sanofi"], ticker: "SNY" },
  { id: "bms", name: "Bristol Myers Squibb", aliases: ["Bristol Myers Squibb", "Bristol-Myers Squibb", "Bristol Myers", "BMS"], ticker: "BMY" },
  { id: "jnj", name: "Johnson & Johnson", aliases: ["Johnson & Johnson", "Johnson and Johnson", "J&J", "Janssen"], ticker: "JNJ" },
  { id: "abbvie", name: "AbbVie", aliases: ["AbbVie"], ticker: "ABBV" },
  { id: "amgen", name: "Amgen", aliases: ["Amgen"], ticker: "AMGN" },
  { id: "lilly", name: "Eli Lilly", aliases: ["Eli Lilly", "Lilly"], ticker: "LLY" },
  { id: "novo-nordisk", name: "Novo Nordisk", aliases: ["Novo Nordisk", "Novo"], ticker: "NVO" },
  { id: "bayer", name: "Bayer", aliases: ["Bayer"] },
  { id: "boehringer", name: "Boehringer Ingelheim", aliases: ["Boehringer Ingelheim", "Boehringer"] },
  { id: "takeda", name: "Takeda", aliases: ["Takeda"], ticker: "TAK" },
  { id: "astellas", name: "Astellas", aliases: ["Astellas"] },
  { id: "daiichi", name: "Daiichi Sankyo", aliases: ["Daiichi Sankyo", "Daiichi"] },
  { id: "eisai", name: "Eisai", aliases: ["Eisai"] },
  { id: "otsuka", name: "Otsuka", aliases: ["Otsuka"] },
  { id: "biogen", name: "Biogen", aliases: ["Biogen"], ticker: "BIIB" },
  { id: "gilead", name: "Gilead", aliases: ["Gilead Sciences", "Gilead"], ticker: "GILD" },
  { id: "vertex", name: "Vertex Pharmaceuticals", aliases: ["Vertex Pharmaceuticals", "Vertex Pharma"], ticker: "VRTX" },
  { id: "regeneron", name: "Regeneron", aliases: ["Regeneron Pharmaceuticals", "Regeneron"], ticker: "REGN" },
  { id: "moderna", name: "Moderna", aliases: ["Moderna"], ticker: "MRNA" },
  { id: "biontech", name: "BioNTech", aliases: ["BioNTech"], ticker: "BNTX" },
  { id: "alnylam", name: "Alnylam", aliases: ["Alnylam Pharmaceuticals", "Alnylam"], ticker: "ALNY" },
  { id: "ionis", name: "Ionis", aliases: ["Ionis Pharmaceuticals", "Ionis"], ticker: "IONS" },
  { id: "incyte", name: "Incyte", aliases: ["Incyte"], ticker: "INCY" },
  { id: "seagen", name: "Seagen", aliases: ["Seagen"] },
  { id: "illumina", name: "Illumina", aliases: ["Illumina"], ticker: "ILMN" },
  { id: "10x-genomics", name: "10x Genomics", aliases: ["10x Genomics"], ticker: "TXG" },
  { id: "thermo-fisher", name: "Thermo Fisher", aliases: ["Thermo Fisher Scientific", "Thermo Fisher"], ticker: "TMO" },
  { id: "danaher", name: "Danaher", aliases: ["Danaher"], ticker: "DHR" },
  { id: "teva", name: "Teva", aliases: ["Teva Pharmaceutical", "Teva"], ticker: "TEVA" },
  { id: "viatris", name: "Viatris", aliases: ["Viatris"], ticker: "VTRS" },
  { id: "csl", name: "CSL", aliases: ["CSL Behring", "CSL Limited"] },
  { id: "ucb", name: "UCB", aliases: ["UCB Pharma"] },
  { id: "servier", name: "Servier", aliases: ["Servier"] },
  { id: "ipsen", name: "Ipsen", aliases: ["Ipsen"] },
  { id: "lundbeck", name: "Lundbeck", aliases: ["Lundbeck"] },
  { id: "leo-pharma", name: "LEO Pharma", aliases: ["LEO Pharma"] },
  { id: "grifols", name: "Grifols", aliases: ["Grifols"] },
  { id: "recursion", name: "Recursion", aliases: ["Recursion Pharmaceuticals", "Recursion"], ticker: "RXRX" },
  { id: "insitro", name: "insitro", aliases: ["insitro"] },
  { id: "altos", name: "Altos Labs", aliases: ["Altos Labs"] },
  { id: "calico", name: "Calico", aliases: ["Calico Life Sciences", "Calico"] },
  { id: "retro-bio", name: "Retro Biosciences", aliases: ["Retro Biosciences"] },
  { id: "newlimit", name: "NewLimit", aliases: ["NewLimit"] },
  { id: "bluerock", name: "BlueRock Therapeutics", aliases: ["BlueRock Therapeutics"], group: "bayer" },
  { id: "legend", name: "Legend Biotech", aliases: ["Legend Biotech", "Legend"], ticker: "LEGN" },
  { id: "beigene", name: "BeiGene", aliases: ["BeiGene", "BeOne Medicines"], ticker: "ONC" },
  { id: "hengrui", name: "Hengrui", aliases: ["Jiangsu Hengrui", "Hengrui Pharma", "Hengrui"] },
  { id: "wuxi", name: "WuXi", aliases: ["WuXi AppTec", "WuXi Biologics", "WuXi"] },
  { id: "summit", name: "Summit Therapeutics", aliases: ["Summit Therapeutics"], ticker: "SMMT" },
  { id: "akeso", name: "Akeso", aliases: ["Akeso Biopharma", "Akeso"] },
  { id: "apnimed", name: "Apnimed", aliases: ["Apnimed"] },
  { id: "replimune", name: "Replimune", aliases: ["Replimune"], ticker: "REPL" },
];

/**
 * Company names that are also ordinary words. These require a corporate cue
 * nearby (ticker, "Inc", "said", "shares", …) before they count as a company.
 */
export const AMBIGUOUS_COMPANY_NAMES = new Set([
  "beam", "prime", "sage", "vertex", "arrowhead", "denali", "atlas", "element",
  "alkermes", "halo", "apogee", "cargo", "kura", "olema", "moderna", "novo",
  "summit", "legend", "recursion", "calico", "altos", "tempus", "verily",
]);

export const CORPORATE_SUFFIXES =
  /\b(Therapeutics|Pharmaceuticals?|Pharma|Biosciences?|Biotherapeutics|Biotechnology|Biotech|BioPharma|Biopharmaceuticals?|Laboratories|Labs|Sciences|Medicines|Medical|Oncology|Genomics|Genetics|Bio|Health|Healthcare)\b/;

export const CORPORATE_CUE =
  /\b(Inc\.?|Corp\.?|Corporation|Ltd\.?|Limited|plc|AG|N\.?V\.?|S\.?A\.?|GmbH|K\.?K\.?|said|announced|acquired|acquires|reported|raised|shares|stock|CEO|CFO|its|NASDAQ|NYSE)\b/;

/* ------------------------------- indications ------------------------------ */

export interface IndicationEntry {
  id: string;
  canonical: string;
  synonyms: string[];
  /** Abbreviations matched case-sensitively, and only with a co-occurrence gate. */
  abbrevs?: string[];
  requires?: RegExp;
  area: string;
}

export const INDICATIONS: IndicationEntry[] = [
  { id: "nsclc", canonical: "non-small cell lung cancer", synonyms: ["non-small cell lung cancer", "non small cell lung cancer"], abbrevs: ["NSCLC"], area: "oncology" },
  { id: "sclc", canonical: "small cell lung cancer", synonyms: ["small cell lung cancer"], abbrevs: ["SCLC"], area: "oncology" },
  { id: "breast-cancer", canonical: "breast cancer", synonyms: ["breast cancer", "triple-negative breast cancer", "HER2-positive breast cancer"], abbrevs: ["TNBC"], area: "oncology" },
  { id: "prostate-cancer", canonical: "prostate cancer", synonyms: ["prostate cancer", "castration-resistant prostate cancer"], abbrevs: ["mCRPC", "CRPC"], area: "oncology" },
  { id: "colorectal-cancer", canonical: "colorectal cancer", synonyms: ["colorectal cancer", "colon cancer", "rectal cancer"], abbrevs: ["CRC"], area: "oncology" },
  { id: "pancreatic-cancer", canonical: "pancreatic cancer", synonyms: ["pancreatic cancer", "pancreatic ductal adenocarcinoma"], abbrevs: ["PDAC"], area: "oncology" },
  { id: "melanoma", canonical: "melanoma", synonyms: ["melanoma"], area: "oncology" },
  { id: "ovarian-cancer", canonical: "ovarian cancer", synonyms: ["ovarian cancer"], area: "oncology" },
  { id: "gastric-cancer", canonical: "gastric cancer", synonyms: ["gastric cancer", "stomach cancer", "gastroesophageal"], area: "oncology" },
  { id: "hcc", canonical: "hepatocellular carcinoma", synonyms: ["hepatocellular carcinoma", "liver cancer"], abbrevs: ["HCC"], area: "oncology" },
  { id: "rcc", canonical: "renal cell carcinoma", synonyms: ["renal cell carcinoma", "kidney cancer"], abbrevs: ["RCC"], area: "oncology" },
  { id: "bladder-cancer", canonical: "bladder cancer", synonyms: ["bladder cancer", "urothelial carcinoma"], area: "oncology" },
  { id: "hnscc", canonical: "head and neck cancer", synonyms: ["head and neck squamous cell carcinoma", "head and neck cancer"], abbrevs: ["HNSCC"], area: "oncology" },
  { id: "glioblastoma", canonical: "glioblastoma", synonyms: ["glioblastoma", "glioma"], abbrevs: ["GBM"], area: "oncology" },
  { id: "aml", canonical: "acute myeloid leukemia", synonyms: ["acute myeloid leukemia", "acute myeloid leukaemia"], abbrevs: ["AML"], area: "hematology" },
  { id: "all", canonical: "acute lymphoblastic leukemia", synonyms: ["acute lymphoblastic leukemia", "acute lymphoblastic leukaemia"], abbrevs: ["B-ALL", "T-ALL"], area: "hematology" },
  { id: "cll", canonical: "chronic lymphocytic leukemia", synonyms: ["chronic lymphocytic leukemia"], abbrevs: ["CLL"], area: "hematology" },
  { id: "cml", canonical: "chronic myeloid leukemia", synonyms: ["chronic myeloid leukemia"], abbrevs: ["CML"], area: "hematology" },
  { id: "multiple-myeloma", canonical: "multiple myeloma", synonyms: ["multiple myeloma"], abbrevs: ["MM"], requires: /myeloma/i, area: "hematology" },
  { id: "dlbcl", canonical: "diffuse large B-cell lymphoma", synonyms: ["diffuse large b-cell lymphoma"], abbrevs: ["DLBCL"], area: "hematology" },
  { id: "lymphoma", canonical: "lymphoma", synonyms: ["lymphoma", "non-Hodgkin lymphoma", "Hodgkin lymphoma"], abbrevs: ["NHL"], area: "hematology" },
  { id: "mds", canonical: "myelodysplastic syndromes", synonyms: ["myelodysplastic syndrome"], abbrevs: ["MDS"], area: "hematology" },
  { id: "sickle-cell", canonical: "sickle cell disease", synonyms: ["sickle cell disease", "sickle-cell disease"], abbrevs: ["SCD"], requires: /sickle/i, area: "hematology" },
  { id: "hemophilia", canonical: "hemophilia", synonyms: ["hemophilia", "haemophilia"], area: "hematology" },
  { id: "beta-thalassemia", canonical: "beta thalassemia", synonyms: ["beta thalassemia", "β-thalassemia", "beta-thalassaemia"], area: "hematology" },
  { id: "alzheimers", canonical: "Alzheimer's disease", synonyms: ["alzheimer's disease", "alzheimers disease", "alzheimer disease"], abbrevs: ["AD"], requires: /alzheimer/i, area: "neurology" },
  { id: "parkinsons", canonical: "Parkinson's disease", synonyms: ["parkinson's disease", "parkinsons disease", "parkinson disease"], abbrevs: ["PD"], requires: /parkinson/i, area: "neurology" },
  { id: "als", canonical: "ALS", synonyms: ["amyotrophic lateral sclerosis"], abbrevs: ["ALS"], area: "neurology" },
  { id: "ms", canonical: "multiple sclerosis", synonyms: ["multiple sclerosis"], abbrevs: ["MS", "RRMS"], requires: /sclerosis|relapsing|EDSS/i, area: "neurology" },
  { id: "huntingtons", canonical: "Huntington's disease", synonyms: ["huntington's disease", "huntington disease"], abbrevs: ["HD"], requires: /huntington/i, area: "neurology" },
  { id: "epilepsy", canonical: "epilepsy", synonyms: ["epilepsy", "seizure disorder"], area: "neurology" },
  { id: "migraine", canonical: "migraine", synonyms: ["migraine"], area: "neurology" },
  { id: "depression", canonical: "major depressive disorder", synonyms: ["major depressive disorder", "depression"], abbrevs: ["MDD"], area: "psychiatry" },
  { id: "schizophrenia", canonical: "schizophrenia", synonyms: ["schizophrenia"], area: "psychiatry" },
  { id: "obesity", canonical: "obesity", synonyms: ["obesity", "overweight"], area: "cardiometabolic" },
  { id: "t2d", canonical: "type 2 diabetes", synonyms: ["type 2 diabetes", "type II diabetes"], abbrevs: ["T2D", "T2DM"], area: "cardiometabolic" },
  { id: "t1d", canonical: "type 1 diabetes", synonyms: ["type 1 diabetes"], abbrevs: ["T1D"], area: "cardiometabolic" },
  { id: "nash", canonical: "MASH", synonyms: ["nonalcoholic steatohepatitis", "metabolic dysfunction-associated steatohepatitis"], abbrevs: ["NASH", "MASH"], area: "cardiometabolic" },
  { id: "ckd", canonical: "chronic kidney disease", synonyms: ["chronic kidney disease"], abbrevs: ["CKD"], area: "nephrology" },
  { id: "heart-failure", canonical: "heart failure", synonyms: ["heart failure", "HFpEF", "HFrEF"], area: "cardiovascular" },
  { id: "atherosclerosis", canonical: "atherosclerotic cardiovascular disease", synonyms: ["atherosclerosis", "atherosclerotic cardiovascular disease"], abbrevs: ["ASCVD"], area: "cardiovascular" },
  { id: "hypertension", canonical: "hypertension", synonyms: ["hypertension", "high blood pressure"], area: "cardiovascular" },
  { id: "pah", canonical: "pulmonary arterial hypertension", synonyms: ["pulmonary arterial hypertension"], abbrevs: ["PAH"], area: "cardiovascular" },
  { id: "copd", canonical: "COPD", synonyms: ["chronic obstructive pulmonary disease"], abbrevs: ["COPD"], area: "respiratory" },
  { id: "asthma", canonical: "asthma", synonyms: ["asthma"], area: "respiratory" },
  { id: "ipf", canonical: "idiopathic pulmonary fibrosis", synonyms: ["idiopathic pulmonary fibrosis"], abbrevs: ["IPF"], area: "respiratory" },
  { id: "cystic-fibrosis", canonical: "cystic fibrosis", synonyms: ["cystic fibrosis"], abbrevs: ["CF"], requires: /fibrosis/i, area: "respiratory" },
  { id: "ra", canonical: "rheumatoid arthritis", synonyms: ["rheumatoid arthritis"], abbrevs: ["RA"], requires: /arthritis|rheumat/i, area: "immunology" },
  { id: "psoriasis", canonical: "psoriasis", synonyms: ["psoriasis", "plaque psoriasis"], area: "immunology" },
  { id: "atopic-dermatitis", canonical: "atopic dermatitis", synonyms: ["atopic dermatitis", "eczema"], area: "immunology" },
  { id: "ibd", canonical: "inflammatory bowel disease", synonyms: ["inflammatory bowel disease", "ulcerative colitis", "crohn's disease"], abbrevs: ["IBD", "UC"], area: "immunology" },
  { id: "lupus", canonical: "lupus", synonyms: ["lupus", "systemic lupus erythematosus"], abbrevs: ["SLE"], area: "immunology" },
  { id: "amd", canonical: "age-related macular degeneration", synonyms: ["age-related macular degeneration", "macular degeneration"], abbrevs: ["AMD", "GA"], requires: /macular|retina/i, area: "ophthalmology" },
  { id: "dme", canonical: "diabetic macular edema", synonyms: ["diabetic macular edema"], abbrevs: ["DME"], area: "ophthalmology" },
  { id: "duchenne", canonical: "Duchenne muscular dystrophy", synonyms: ["duchenne muscular dystrophy"], abbrevs: ["DMD"], area: "rare disease" },
  { id: "sma", canonical: "spinal muscular atrophy", synonyms: ["spinal muscular atrophy"], abbrevs: ["SMA"], area: "rare disease" },
  { id: "attr", canonical: "ATTR amyloidosis", synonyms: ["transthyretin amyloidosis", "attr amyloidosis"], abbrevs: ["ATTR"], area: "rare disease" },
  { id: "aging", canonical: "aging", synonyms: ["aging", "ageing", "healthspan", "longevity"], area: "aging" },
  { id: "sarcopenia", canonical: "sarcopenia", synonyms: ["sarcopenia", "frailty"], area: "aging" },
  { id: "covid", canonical: "COVID-19", synonyms: ["covid-19", "sars-cov-2"], area: "infectious disease" },
  { id: "hiv", canonical: "HIV", synonyms: ["hiv", "human immunodeficiency virus"], abbrevs: ["HIV"], area: "infectious disease" },
  { id: "rsv", canonical: "RSV", synonyms: ["respiratory syncytial virus"], abbrevs: ["RSV"], area: "infectious disease" },
  { id: "influenza", canonical: "influenza", synonyms: ["influenza", "flu"], area: "infectious disease" },
  { id: "hepatitis-b", canonical: "hepatitis B", synonyms: ["hepatitis b"], abbrevs: ["HBV"], area: "infectious disease" },
];

/* ------------------------------- modalities ------------------------------- */

export const MODALITIES: { id: string; label: string; patterns: RegExp }[] = [
  { id: "adc", label: "ADC", patterns: /\b(antibody[- ]drug conjugate|ADCs?)\b/g },
  { id: "car-t", label: "CAR-T", patterns: /\b(CAR[- ]?T\b|chimeric antigen receptor)/gi },
  { id: "tcr-t", label: "TCR-T", patterns: /\b(TCR[- ]?T\b|T[- ]cell receptor therapy)/gi },
  { id: "til", label: "TIL", patterns: /\b(tumor[- ]infiltrating lymphocytes?|TILs?)\b/g },
  { id: "bispecific", label: "bispecific", patterns: /\b(bispecific|trispecific|BiTE|T[- ]cell engager)\b/gi },
  { id: "sirna", label: "siRNA", patterns: /\b(siRNA|RNAi|RNA interference)\b/gi },
  { id: "aso", label: "antisense", patterns: /\b(antisense oligonucleotide|ASOs?)\b/g },
  { id: "mrna", label: "mRNA", patterns: /\b(mRNA|self-amplifying RNA|saRNA)\b/g },
  { id: "gene-editing", label: "gene editing", patterns: /\b(CRISPR|Cas9|Cas12|base editing|prime editing|epigenome editing|gene editing)\b/gi },
  { id: "aav", label: "AAV", patterns: /\b(AAV|adeno-associated virus|lentiviral|lentivirus)\b/gi },
  { id: "lnp", label: "LNP", patterns: /\b(lipid nanoparticle|LNPs?|GalNAc)\b/g },
  { id: "degrader", label: "degrader", patterns: /\b(PROTACs?|molecular glue|targeted protein degrad\w+|CELMoDs?|degraders?)\b/gi },
  { id: "radioligand", label: "radioligand", patterns: /\b(radioligand|radiopharmaceutical|radioconjugate)\b/gi },
  { id: "glp1", label: "GLP-1", patterns: /\b(GLP-?1|GIP\b|amylin|dual agonist|triple agonist|incretin)\b/gi },
  { id: "checkpoint", label: "checkpoint", patterns: /\b(checkpoint inhibitor|PD-?1|PD-?L1|CTLA-?4)\b/gi },
  { id: "cell-therapy", label: "cell therapy", patterns: /\b(allogeneic|autologous|iPSC|induced pluripotent|stem cell therapy)\b/gi },
  { id: "oncolytic", label: "oncolytic", patterns: /\b(oncolytic (virus|viral|immunotherapy))\b/gi },
  { id: "microbiome", label: "microbiome", patterns: /\b(microbiome|microbiota)\b/gi },
  { id: "reprogramming", label: "reprogramming", patterns: /\b(partial reprogramming|Yamanaka factors?|cellular reprogramming|OSKM)\b/gi },
  { id: "senolytic", label: "senolytic", patterns: /\b(senolytics?|senomorphics?|senescent cell clearance)\b/gi },
  { id: "vaccine", label: "vaccine", patterns: /\b(vaccines?|immunization)\b/gi },
  { id: "biosimilar", label: "biosimilar", patterns: /\b(biosimilars?)\b/gi },
];

/* --------------------------------- targets -------------------------------- */

/** Well-known drug targets: bypass the ambiguity gate entirely. */
export const TARGET_WHITELIST = new Set([
  "PD-1", "PD-L1", "CTLA-4", "HER2", "HER3", "EGFR", "KRAS", "NRAS", "BRAF",
  "ALK", "ROS1", "RET", "MET", "FGFR", "BTK", "BCL2", "CD19", "CD20", "CD3",
  "BCMA", "GPRC5D", "TROP2", "CLDN18.2", "DLL3", "NECTIN4", "FOLR1", "PSMA",
  "LRRK2", "APOE", "TTR", "PCSK9", "LPA", "ANGPTL3", "GLP-1R", "GIPR", "GCGR",
  "IL-23", "IL-17", "IL-4R", "IL-5", "IL-6", "IL-13", "TL1A", "TSLP", "FcRn",
  "C5", "C3", "NLRP3", "STING", "cGAS", "WRN", "USP1", "PARP1", "ATR", "WEE1",
  "PRMT5", "MTAP", "SMARCA2", "KAT6A", "MDM2", "TP53", "SOD1", "TDP-43",
  "SGLT2", "DPP-4", "JAK1", "JAK2", "TYK2", "S1P", "CFTR", "VEGF", "VEGFR",
  "TNF", "CD38", "CD47", "SIRPA", "LAG-3", "TIGIT", "TIM-3", "AXL", "CDK4",
  "CDK6", "CDK7", "CDK9", "PI3K", "AKT", "mTOR", "MEK", "ERK", "SHP2", "SOS1",
  "MYC", "BCL6", "EZH2", "DNMT1", "DNMT3A", "TET2", "SIRT1", "SIRT6", "mTORC1",
  "AMPK", "NAD+", "NMN", "NR", "CD73", "A2AR", "HIF-2a", "VHL", "IDH1", "IDH2",
  "FLT3", "NPM1", "TERT", "CTCF", "cohesin", "YAP", "TAZ", "Nrf2", "GPX4",
]);

/** Gene symbols that are ordinary words — never a target without a whitelist hit. */
export const TARGET_HOMOGRAPHS = new Set([
  "SET", "MAX", "CAT", "AGO", "IMPACT", "CAMP", "REST", "TANK", "WARS", "CARS",
  "MARS", "SPARC", "ACHE", "ARID", "MICE", "PIGS", "HOPS", "BAD", "SHE", "APP",
  "AIR", "ARM", "BEST", "BIG", "CAN", "CAP", "CLOCK", "COIL", "DAD", "END",
  "FAT", "GAN", "HAT", "HOT", "ICE", "JUN", "KIT", "LAG", "MAP", "NET", "OWL",
  "PIP", "RAN", "SAT", "TIP", "USA", "WAS", "WHO", "WNT", "YES", "ZIP",
]);

export const TARGET_CONTEXT =
  /\b(gene|expression|mutation|variant|knockout|knockdown|inhibitor|inhibition|targeting|receptor|protein|pathway|signaling|positive|negative|mutant|allele|fusion|agonist|antagonist|degrader|antibody|amplif\w+|overexpress\w+)\b/i;
