import { parseFeedDate } from "../normalize/dates";
import { htmlToText } from "../normalize/html";
import { canonicalizeUrl } from "../normalize/url";
import { squish, truncateWords } from "../normalize/text";
import type { SourceDef } from "../config/sources";
import type { IngestResult, NormalizedItem } from "./types";

/** JSON sources that hand us structured metadata instead of RSS. */

function base(source: SourceDef): Omit<
  NormalizedItem,
  | "title"
  | "url"
  | "canonicalUrl"
  | "bodyText"
  | "bodyProvenance"
  | "publishedAt"
  | "datePrecision"
  | "dateConfident"
> {
  return {
    sourceId: source.id,
    sourceName: source.name,
    publisherGroup: source.publisherGroup,
    sourceKind: source.kind,
    authority: source.authority,
    laneHints: source.laneHints,
    paywalled: source.paywalled,
    guid: undefined,
    categories: [],
    authors: [],
    doi: undefined,
    nctIds: [],
    warnings: [],
  };
}

interface EuropePmcResult {
  id?: string;
  source?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  abstractText?: string;
  firstPublicationDate?: string;
  journalInfo?: { journal?: { title?: string } };
  fullTextUrlList?: { fullTextUrl?: { url?: string }[] };
}

export function parseEuropePmc(json: string, source: SourceDef, now: Date): IngestResult {
  const warnings: string[] = [];
  let payload: { resultList?: { result?: EuropePmcResult[] } };
  try {
    payload = JSON.parse(json) as typeof payload;
  } catch (error) {
    return { items: [], parsed: 0, warnings: [`json-parse-failed: ${String(error)}`] };
  }

  const results = payload.resultList?.result ?? [];
  const items: NormalizedItem[] = [];

  for (const result of results.slice(0, source.maxItems)) {
    const title = squish(result.title ?? "");
    if (!title) continue;

    const doi = result.doi?.toLowerCase();
    const url =
      result.fullTextUrlList?.fullTextUrl?.[0]?.url ??
      (doi ? `https://doi.org/${doi}` : undefined) ??
      (result.id && result.source
        ? `https://europepmc.org/article/${result.source}/${result.id}`
        : undefined);
    if (!url) continue;

    const date = parseFeedDate(result.firstPublicationDate, { now });
    // resultType=core returns a real abstract: the abstract IS the summary.
    const abstract = squish(htmlToText(result.abstractText ?? ""));

    items.push({
      ...base(source),
      title,
      url,
      canonicalUrl: canonicalizeUrl(url),
      publishedAt: date.date ?? undefined,
      datePrecision: date.precision,
      dateConfident: date.confident,
      bodyText: truncateWords(abstract, 6000),
      bodyProvenance: abstract ? "abstract" : "none",
      authors: result.authorString ? [squish(result.authorString)] : [],
      doi,
      categories: result.journalInfo?.journal?.title
        ? [squish(result.journalInfo.journal.title)]
        : [],
    });
  }

  return { items, parsed: results.length, warnings };
}

interface CtgStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string };
    descriptionModule?: { briefSummary?: string };
    designModule?: { phases?: string[]; enrollmentInfo?: { count?: number } };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    conditionsModule?: { conditions?: string[] };
    armsInterventionsModule?: { interventions?: { name?: string; type?: string }[] };
    statusModule?: {
      lastUpdatePostDateStruct?: { date?: string };
      startDateStruct?: { date?: string };
    };
  };
}

export function parseClinicalTrials(json: string, source: SourceDef, now: Date): IngestResult {
  let payload: { studies?: CtgStudy[] };
  try {
    payload = JSON.parse(json) as typeof payload;
  } catch (error) {
    return { items: [], parsed: 0, warnings: [`json-parse-failed: ${String(error)}`] };
  }

  const studies = payload.studies ?? [];
  const items: NormalizedItem[] = [];

  for (const study of studies.slice(0, source.maxItems)) {
    const p = study.protocolSection;
    const nct = p?.identificationModule?.nctId;
    const title = squish(p?.identificationModule?.briefTitle ?? "");
    if (!nct || !title) continue;

    const url = `https://clinicaltrials.gov/study/${nct}`;
    const sponsor = squish(p?.sponsorCollaboratorsModule?.leadSponsor?.name ?? "");
    const conditions = (p?.conditionsModule?.conditions ?? []).map(squish).filter(Boolean);
    const interventions = (p?.armsInterventionsModule?.interventions ?? [])
      .map((i) => squish(i.name ?? ""))
      .filter(Boolean);
    const phases = (p?.designModule?.phases ?? []).join("/").replace(/PHASE/g, "Phase ");
    const enrollment = p?.designModule?.enrollmentInfo?.count;

    // Compose a factual body — no invented prose, just the registry fields.
    const summary = squish(p?.descriptionModule?.briefSummary ?? "");
    const facts = [
      phases ? `${phases} trial.` : "",
      sponsor ? `Lead sponsor: ${sponsor}.` : "",
      conditions.length ? `Conditions: ${conditions.join(", ")}.` : "",
      interventions.length ? `Interventions: ${interventions.join(", ")}.` : "",
      enrollment ? `Planned enrollment: ${enrollment} participants.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const date = parseFeedDate(
      p?.statusModule?.lastUpdatePostDateStruct?.date ?? p?.statusModule?.startDateStruct?.date,
      { now },
    );

    items.push({
      ...base(source),
      title,
      url,
      canonicalUrl: canonicalizeUrl(url),
      publishedAt: date.date ?? undefined,
      datePrecision: date.precision,
      dateConfident: date.confident,
      bodyText: truncateWords(squish(`${facts} ${summary}`), 4000),
      bodyProvenance: "api",
      categories: conditions,
      nctIds: [nct],
    });
  }

  return { items, parsed: studies.length, warnings: [] };
}
