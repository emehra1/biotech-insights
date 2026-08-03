export type InsightItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  summary: string;
  abstract?: string;
  executiveSummary?: string;
  category: string;
  tags: string[];
  drugNames: string[];
  indications: string[];
  trialDetails: string;
  isAcademic?: boolean;
};

export type InsightSummary = {
  overview: InsightItem[];
  categories: {
    name: string;
    description: string;
    items: InsightItem[];
  }[];
};
