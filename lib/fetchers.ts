import Parser from "rss-parser";
import cheerio from "cheerio";
import { InsightItem, InsightSummary } from "@/lib/types";

const parser = new Parser({
  timeout: 15000,
  requestOptions: {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15"
    }
  }
});

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const SOURCE_MAP = [
  {
    name: "Endpoints News",
    url: "https://endpts.com/feed/",
    category: "Biotech News",
    tags: ["deal", "acquisition", "funding", "platform", "clinical", "trial"],
    fetchPageDetails: true
  },
  {
    name: "Fierce Biotech",
    url: "https://www.fiercebiotech.com/rss.xml",
    category: "Biotech News",
    tags: ["clinical", "immunology", "aging", "acquisition", "platform"],
    fetchPageDetails: true
  },
  {
    name: "Fierce Pharma",
    url: "https://www.fiercepharma.com/rss.xml",
    category: "Biotech News",
    tags: ["deal", "regulatory", "commercial", "pharma", "launch", "acquisition"],
    fetchPageDetails: true
  },
  {
    name: "Nature",
    url: "https://www.nature.com/nature.rss",
    category: "Academic Papers",
    tags: ["translational", "aging", "epigenetics", "genome", "single-cell"],
    isAcademic: true
  },
  {
    name: "Science",
    url: "https://www.science.org/rss/news_content.xml",
    category: "Academic Papers",
    tags: ["translational", "neuroscience", "immunology", "aging"],
    isAcademic: true
  },
  {
    name: "JAMA",
    url: "https://jamanetwork.com/journals/jama/rss.xml",
    category: "Academic Papers",
    tags: ["clinical", "cardiovascular", "cancer", "immunology"],
    isAcademic: true
  },
  {
    name: "Cell",
    url: "https://www.cell.com/cell/current.rss",
    category: "Academic Papers",
    tags: ["single-cell", "omics", "epigenetics", "translational"],
    isAcademic: true
  },
  {
    name: "NEJM",
    url: "https://www.nejm.org/rss",
    category: "Academic Papers",
    tags: ["clinical", "pharma", "translational", "cardiovascular"],
    isAcademic: true
  },
  {
    name: "bioRxiv",
    url: "https://connect.biorxiv.org/relate/feed/",
    category: "Academic Papers",
    tags: ["preprint", "aging", "single-cell", "genome"],
    isAcademic: true
  },
  {
    name: "medRxiv",
    url: "https://connect.medrxiv.org/relate/feed/",
    category: "Academic Papers",
    tags: ["preprint", "clinical", "immunology", "aging"],
    isAcademic: true
  }
];

const KNOWN_INDICATIONS = [
  "cancer",
  "tumor",
  "tumour",
  "metastatic",
  "glioblastoma",
  "NSCLC",
  "breast cancer",
  "lung cancer",
  "AML",
  "lymphoma",
  "multiple sclerosis",
  "arthritis",
  "cardiovascular",
  "heart failure",
  "CVD",
  "neurodegenerative",
  "Alzheimer",
  "Parkinson",
  "diabetes",
  "NASH",
  "fibrosis",
  "autoimmune",
  "inflammatory",
  "infection",
  "COVID",
  "HIV",
  "renal",
  "kidney",
  "hepatic",
  "age-related",
  "aging",
  "senescence",
  "immunosenescence",
  "epigenetic",
  "chromatin"
];

const STOPWORDS = new Set([
  "The",
  "For",
  "With",
  "From",
  "This",
  "That",
  "These",
  "Those",
  "Their",
  "After",
  "When",
  "While",
  "Patients",
  "Patient",
  "Study",
  "Trial",
  "Phase",
  "In",
  "Of",
  "A",
  "An",
  "And",
  "Or",
  "To",
  "By",
  "On",
  "At",
  "Is",
  "As",
  "New",
  "The",
  "A",
  "An",
  "It",
  "Its"
]);

function normalizeText(text?: string): string {
  return text?.replace(/\s+/g, " ").trim() ?? "";
}

function parsePublishedAt(entry: Parser.Item): Date | null {
  const dateString = entry.isoDate ?? entry.pubDate;
  if (!dateString) {
    return null;
  }
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWithinLastWeek(date?: Date | null): boolean {
  if (!date) return false;
  return Date.now() - date.getTime() <= RECENT_WINDOW_MS;
}

function extractDrugNames(text: string): string[] {
  const results = new Set<string>();
  const drugRegex = /(?:drug|therapy|compound|agent|antibody|mAb|ADC|oligonucleotide|ASO|siRNA|inhibitor|agonist|antagonist|peptide|small molecule|modality)\s+([A-Z][A-Za-z0-9\-]{2,})/gi;
  let match: RegExpExecArray | null;
  while ((match = drugRegex.exec(text))) {
    results.add(match[1]);
  }

  const tokens = text.match(/\b[A-Z][A-Za-z0-9\-]{2,}\b/g) ?? [];
  tokens.forEach((token) => {
    if (STOPWORDS.has(token)) return;
    if (token.length > 4 && /\d/.test(token)) {
      results.add(token);
    }
    if (/^[A-Z]{2,}[0-9]/.test(token) || /[A-Z][a-z]{2,}/.test(token)) {
      if (!/^(The|For|With|From|This|That|These|Those|Their|After|When|While|Patients|Patient|Study|Trial|Phase|In|Of|A|An|And|Or|To|By|On|At|Is|As|It|Its)$/.test(token)) {
        results.add(token);
      }
    }
  });

  return Array.from(results).slice(0, 6);
}

function extractIndications(text: string): string[] {
  const lowerText = text.toLowerCase();
  const findings = new Set<string>();
  const patterns = [
    /for ([A-Za-z0-9 ,\-&()\/]+?)(?:\.|,|;| in | among | to | with |$)/gi,
    /in patients with ([A-Za-z0-9 ,\-&()\/]+?)(?:\.|,|;|$)/gi,
    /treating ([A-Za-z0-9 ,\-&()\/]+?)(?:\.|,|;|$)/gi,
    /for the treatment of ([A-Za-z0-9 ,\-&()\/]+?)(?:\.|,|;|$)/gi,
    /for patients with ([A-Za-z0-9 ,\-&()\/]+?)(?:\.|,|;|$)/gi
  ];

  patterns.forEach((pattern) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const candidate = normalizeText(match[1]);
      if (candidate.length > 4) {
        findings.add(candidate);
      }
    }
  });

  KNOWN_INDICATIONS.forEach((indication) => {
    if (lowerText.includes(indication.toLowerCase())) {
      findings.add(indication);
    }
  });

  return Array.from(findings).slice(0, 6);
}

function extractTrialDetails(text: string): string {
  const match = text.match(/(phase [1-4b1\/]+|topline|readout|ORR|PFS|OS|safety|response rate|median [A-Za-z]+|dose escalation|dose expansion|placebo|randomized|double-blind|cohort|open-label)/i);
  if (match) {
    return match[0];
  }
  const nMatch = text.match(/N\s?=\s?\d{1,4}/i);
  if (nMatch) {
    return nMatch[0];
  }
  return "";
}

function cleanAcademicAbstract(text: string): string {
  if (!text) return "";
  let cleaned = text;
  cleaned = cleaned.replace(/Author Information[\s\S]*?(?=Abstract|Background|Introduction|Methods|Results|$)/gi, "");
  cleaned = cleaned.replace(/Affiliations?[\s\S]*?(?=Abstract|Background|Introduction|Methods|Results|$)/gi, "");
  cleaned = cleaned.replace(/Correspondence (to|address)[^.]*\./gi, "");
  cleaned = cleaned.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "");
  cleaned = cleaned.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\d(?:,\d)*\b/g, "");
  cleaned = cleaned.replace(/^By [A-Z][A-Za-z .,\-]+?(?=[A-Z][a-z]{3,} )/g, "");
  return normalizeText(cleaned);
}

function buildExecutiveSummary(title: string, summary: string, articleText: string): string {
  if (!articleText) return "";
  const words = articleText.split(/\s+/).filter(Boolean);
  const body = words.slice(0, 600).join(" ");
  const truncated = words.length > 600 ? `${body}…` : body;
  if (truncated && summary && truncated.startsWith(summary.slice(0, 80))) {
    return [title, truncated].filter(Boolean).join("\n\n");
  }
  return [title, summary, truncated].map((p) => p.trim()).filter(Boolean).join("\n\n");
}

function extractAbstract(summary: string, articleText: string): string {
  if (summary.length > 220) {
    return summary;
  }
  const candidate = articleText.split(". ").slice(0, 3).join(". ");
  return candidate || summary;
}

async function fetchArticleDetails(url: string): Promise<{ articleText: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15"
      }
    });

    if (!response.ok) {
      return { articleText: "" };
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const selectors = [
      "article",
      ".article-body",
      ".l-article__body",
      ".c-article-body",
      "#main-content",
      ".article-content",
      ".content-body"
    ];

    let articleText = "";
    for (const selector of selectors) {
      const first = $(selector).first();
      if (first.length) {
        articleText = normalizeText(first.text());
        if (articleText.length > 120) break;
      }
    }

    if (!articleText) {
      articleText = normalizeText($("p").slice(0, 12).text());
    }

    return { articleText };
  } catch {
    return { articleText: "" };
  }
}

function buildItem(entry: Parser.Item, source: string, category: string, tags: string[], articleText: string, isAcademic: boolean): InsightItem {
  const title = normalizeText(entry.title);
  const rawSummary = normalizeText(entry.contentSnippet ?? entry.content ?? "No summary available.");
  const summary = isAcademic ? cleanAcademicAbstract(rawSummary) || rawSummary : rawSummary;
  const cleanedArticleText = isAcademic ? cleanAcademicAbstract(articleText) : articleText;
  const url = entry.link ?? "";
  const publishedAt = entry.isoDate ?? entry.pubDate ?? undefined;
  const mergedText = normalizeText(`${title} ${summary} ${cleanedArticleText}`);

  const item: InsightItem = {
    id: `${source}-${url}`,
    title,
    url,
    source,
    publishedAt,
    summary,
    abstract: extractAbstract(summary, cleanedArticleText),
    category,
    tags,
    drugNames: extractDrugNames(mergedText),
    indications: extractIndications(mergedText),
    trialDetails: extractTrialDetails(mergedText),
    isAcademic
  };

  if (!isAcademic && cleanedArticleText) {
    item.executiveSummary = buildExecutiveSummary(title, summary, cleanedArticleText);
  }

  return item;
}

async function fetchFeed(source: {
  name: string;
  url: string;
  category: string;
  tags: string[];
  isAcademic?: boolean;
  fetchPageDetails?: boolean;
}): Promise<InsightItem[]> {
  try {
    const feed = await parser.parseURL(source.url);
    const items = await Promise.all(
      (feed.items ?? [])
        .filter((entry) => {
          if (!source.isAcademic) return true;
          const date = parsePublishedAt(entry);
          return isWithinLastWeek(date);
        })
        .slice(0, 24)
        .map(async (entry) => {
          const details = source.fetchPageDetails ? await fetchArticleDetails(entry.link ?? "") : { articleText: "" };
          return buildItem(entry, source.name, source.category, source.tags, details.articleText, source.isAcademic ?? false);
        })
    );
    return items.filter(Boolean);
  } catch (error) {
    console.warn(`Unable to fetch ${source.name}:`, error);
    return [];
  }
}

function scoreRelevance(text: string, keywords: string[]): number {
  const lowerText = text.toLowerCase();
  let score = 0;
  keywords.forEach((keyword) => {
    if (lowerText.includes(keyword.toLowerCase())) {
      score += 1;
    }
  });
  return score;
}

function categorizeItems(items: InsightItem[]): InsightSummary {
  const categories = [
    {
      name: "Biotech News & Deals",
      description: "Latest deal-making, acquisitions, platform R&D, and clinical readouts in biotech.",
      items: [] as InsightItem[]
    },
    {
      name: "Translational Age-related Science",
      description: "Papers and updates with clear translational evidence for age-related diseases.",
      items: [] as InsightItem[]
    },
    {
      name: "Aging Biology",
      description: "Academic work focused on aging, immune aging, and age-associated biology.",
      items: [] as InsightItem[]
    },
    {
      name: "Epigenetics",
      description: "Studies centered on chromatin, epigenetic regulation, and age-related epigenetic mechanisms.",
      items: [] as InsightItem[]
    },
    {
      name: "3D Genome & Single-Cell Omics",
      description: "High-resolution genome architecture, spatial biology, and single-cell multi-omics research.",
      items: [] as InsightItem[]
    }
  ];

  items.forEach((item) => {
    const text = `${item.title} ${item.summary}`;
    if (scoreRelevance(text, SOURCE_MAP[0].tags) >= 1 || scoreRelevance(text, SOURCE_MAP[1].tags) >= 1 || item.source.includes("Fierce") || item.source.includes("Endpoints")) {
      categories[0].items.push(item);
    }
    if (scoreRelevance(text, ["pharmacokinetics", "PK", "PD", "clinical", "phase", "trial", "dose", "efficacy", "translational"]) >= 1 || scoreRelevance(text, ["aging", "neurodegenerative", "cardiovascular"]) >= 1) {
      categories[1].items.push(item);
    }
    if (scoreRelevance(text, ["aging", "age-related", "senescence", "geroscience", "immune aging"]) >= 1) {
      categories[2].items.push(item);
    }
    if (scoreRelevance(text, ["epigenetic", "DNA methylation", "chromatin", "histone", "epigenome"]) >= 1) {
      categories[3].items.push(item);
    }
    if (scoreRelevance(text, ["single-cell", "single cell", "scRNA", "scATAC", "Hi-C", "3D genome", "spatial transcriptomics", "genome architecture"]) >= 1) {
      categories[4].items.push(item);
    }
  });

  return {
    overview: items.slice(0, 12),
    categories: categories.map((category) => ({
      ...category,
      items: category.items.slice(0, 8)
    }))
  };
}

export async function getSummary(): Promise<InsightSummary> {
  const feeds = await Promise.all(SOURCE_MAP.map(fetchFeed));
  const flatItems = feeds
    .flat()
    .filter((item) => item.title && item.url)
    .sort((a, b) => {
      const aDate = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bDate = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bDate - aDate;
    });

  return categorizeItems(flatItems);
}
