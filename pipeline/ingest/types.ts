import type { BodyProvenance, FocusLane, SourceKind } from "../../lib/types";
import type { DatePrecision } from "../normalize/dates";

/** One item after normalization, before extraction/scoring. */
export interface NormalizedItem {
  sourceId: string;
  sourceName: string;
  publisherGroup: string;
  sourceKind: SourceKind;
  authority: number;
  laneHints: Partial<Record<FocusLane, number>>;
  paywalled: boolean;

  title: string;
  url: string;
  canonicalUrl: string;
  guid?: string;

  publishedAt?: Date;
  datePrecision: DatePrecision;
  dateConfident: boolean;

  /** Best available body text. Never a fabricated summary. */
  bodyText: string;
  bodyProvenance: BodyProvenance;

  categories: string[];
  authors: string[];
  doi?: string;
  nctIds: string[];
  warnings: string[];
}

export interface IngestResult {
  items: NormalizedItem[];
  parsed: number;
  warnings: string[];
}
