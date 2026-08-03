import { describe, expect, it } from "vitest";

import { displayable, extractCompanies, extractDrugs, extractEntities, extractIndications, extractTargets } from "../pipeline/extract/entities";
import { buildKeyFacts, detectEvidenceLevel, detectOutcome, extractDeal } from "../pipeline/extract/facts";

const noCompanies = new Set<string>();

function drugNames(title: string, body = ""): string[] {
  return displayable(extractDrugs({ title, body }, noCompanies)).map((d) => d.text.toLowerCase());
}

describe("drug extraction — negative corpus", () => {
  /**
   * These sentences must yield ZERO drugs. Precision regressions are invisible
   * without this block, and it is worth more than all the positive cases: the
   * previous implementation turned every capitalized word into a drug name.
   */
  const mustBeEmpty = [
    "The company will translate the mandate into a candidate list before the update.",
    "Novo Nordisk left praying to Artemis and Hermes to salvage CKD program after phase 3 fail",
    "Chutes & Ladders—Legend CEO departs without successor in place",
    "From Abu Dhabi to Brazil, every region is vying for the new emerging economy of biotech",
    "Analysts forecast a substantial increase in revenue, with essential guidance maintained.",
    "The protease and polymerase assays validate the alternative platform.",
    "Three regions are fighting for their place in the future of biotech.",
    "A database of patient outcomes showed a decrease in disease progression.",
    "Executive leadership presented the initiative at the annual investor day.",
    "The trial will examine whether the machine learning model can determine baseline risk.",
    "Senate measure would block plan to politicize federal grants, for now",
    "This article is part of our ongoing coverage; subscribe to continue reading.",
    "Q2 earnings roundup: guidance raised, pipeline unchanged, no material updates.",
    "The company said it obtained substantial capital to control operating costs.",
    "Researchers combined single-cell and spatial methods to examine chromatin architecture.",
  ];

  for (const sentence of mustBeEmpty) {
    it(`finds no drug in: ${sentence.slice(0, 62)}…`, () => {
      expect(drugNames(sentence)).toEqual([]);
    });
  }
});

describe("drug extraction — positive cases", () => {
  it("finds ziltivekimab in the real Fierce dek", () => {
    const names = drugNames(
      "Novo Nordisk left praying to Artemis and Hermes to salvage CKD program after phase 3 fail",
      "A phase 3 trial of Novo Nordisk's ziltivekimab has missed its primary endpoint, denting the prospects of a molecule analysts tipped to generate blockbuster sales.",
    );
    expect(names).toContain("ziltivekimab");
    // And still none of the false positives the old code produced.
    for (const bad of ["novo", "nordisk", "artemis", "hermes", "ckd"]) {
      expect(names).not.toContain(bad);
    }
  });

  it("finds an ADC payload word", () => {
    expect(drugNames("Trial of trastuzumab deruxtecan in HER2-low breast cancer")).toContain(
      "deruxtecan",
    );
  });

  it("finds development codes but not blocklisted prefixes", () => {
    const names = drugNames("AZD1234 and BMS-986278 advanced, while NCT05012345 enrolled patients");
    expect(names).toContain("azd1234");
    expect(names).toContain("bms-986278");
    expect(names.some((n) => n.startsWith("nct"))).toBe(false);
  });

  it("does not treat a bare year or a dollar figure as a code", () => {
    expect(drugNames("The 2026 guidance implies $500 million in sales for Q3 2026")).toEqual([]);
  });

  it("keeps -ase enzymes out of the drug list", () => {
    expect(drugNames("The kinase and nuclease inhibitors were compared")).toEqual([]);
  });
});

describe("company extraction", () => {
  it("prefers the longest alias", () => {
    const names = extractCompanies({
      title: "AstraZeneca, Bristol Myers Squibb are in talks about merger",
      body: "",
    }).map((c) => c.canonical);
    expect(names).toContain("Bristol Myers Squibb");
    expect(names).toContain("AstraZeneca");
  });

  it("catches long-tail companies by corporate suffix without a dictionary entry", () => {
    const names = extractCompanies({
      title: "Aurora Biosciences raises $80M",
      body: "Aurora Biosciences will fund its lead program.",
    }).map((c) => c.canonical);
    expect(names.some((n) => n.includes("Aurora Biosciences"))).toBe(true);
  });

  it("requires a corporate cue for ambiguous single-word names", () => {
    const withoutCue = extractCompanies({
      title: "Beam geometry improves the prime focus of the telescope",
      body: "The atlas of images was assembled by hand.",
    }).map((c) => c.canonical);
    expect(withoutCue).toEqual([]);
  });

  it("assigns acquirer and target roles in an M&A sentence", () => {
    const entities = extractEntities(
      {
        title: "AstraZeneca to acquire Replimune",
        body: "AstraZeneca said it will acquire Replimune in a deal worth $2 billion.",
      },
      [],
    );
    const roles = new Map(entities.companies.map((c) => [c.canonical, c.role]));
    expect(roles.get("AstraZeneca")).toBe("acquirer");
    expect(roles.get("Replimune")).toBe("target");
  });
});

describe("indication extraction", () => {
  it("matches full names", () => {
    const found = extractIndications({
      title: "Trial in non-small cell lung cancer",
      body: "",
    }).map((i) => i.canonical);
    expect(found).toContain("non-small cell lung cancer");
  });

  it("gates ambiguous abbreviations on the full form appearing", () => {
    const bare = extractIndications({ title: "The MS in the AD group", body: "" }).map(
      (i) => i.canonical,
    );
    expect(bare).not.toContain("multiple sclerosis");
    expect(bare).not.toContain("Alzheimer's disease");

    const gated = extractIndications({
      title: "MS relapse rates fell",
      body: "Patients with relapsing multiple sclerosis were enrolled.",
    }).map((i) => i.canonical);
    expect(gated).toContain("multiple sclerosis");
  });
});

describe("target extraction", () => {
  it("accepts whitelisted targets without context", () => {
    expect(extractTargets({ title: "A PD-L1 story", body: "" }).map((t) => t.text)).toContain(
      "PD-L1",
    );
  });

  it("rejects gene-symbol homographs", () => {
    const found = extractTargets({
      title: "The SET of MAX values in the CAT scan",
      body: "REST and TANK were unchanged.",
    }).map((t) => t.text);
    expect(found).toEqual([]);
  });

  it("requires context for non-whitelisted symbols", () => {
    const withContext = extractTargets({
      title: "ABCD1 expression rose",
      body: "ABCD1 gene expression was measured.",
    }).map((t) => t.text);
    expect(withContext).toContain("ABCD1");
  });
});

describe("outcome polarity", () => {
  it("detects a hit", () => {
    expect(detectOutcome("The trial met its primary endpoint.")).toBe("met");
  });

  it("detects a miss", () => {
    expect(detectOutcome("Ziltivekimab missed its primary endpoint.")).toBe("missed");
  });

  it("reports mixed rather than guessing", () => {
    expect(
      detectOutcome(
        "The study met its primary endpoint but failed to meet the co-primary endpoint.",
      ),
    ).toBe("mixed");
  });

  it("returns undefined when there is no readout language", () => {
    expect(detectOutcome("The company appointed a new CEO.")).toBeUndefined();
  });
});

describe("evidence level", () => {
  it("flags mouse work as preclinical", () => {
    expect(detectEvidenceLevel("A combination of drugs restores stem-cell function in mice.")).toBe(
      "preclinical",
    );
  });

  it("flags patient work as clinical", () => {
    expect(detectEvidenceLevel("A phase 3 trial randomized 6,000 patients.")).toBe("clinical");
  });

  it("separates pure in-vitro work", () => {
    expect(detectEvidenceLevel("Organoids and cell lines were treated in vitro.")).toBe("in-vitro");
  });
});

describe("deal extraction", () => {
  it("splits upfront from milestones and never FX-converts", () => {
    const deal = extractDeal(
      "Pfizer will pay $250 million upfront and up to $1.2 billion in milestones for global rights.",
    );
    expect(deal?.type).toBe("license");
    expect(deal?.upfrontUsdM).toBe(250);
    expect(deal?.totalUsdM).toBe(1200);
    expect(deal?.currency).toBe("USD");
  });

  it("records a non-USD currency without converting", () => {
    const deal = extractDeal("Bayer agreed to acquire the unit for €800 million.");
    expect(deal?.currency).toBe("EUR");
    expect(deal?.totalUsdM).toBeUndefined();
  });

  it("recognizes an IPO", () => {
    const deal = extractDeal("Apnimed raised $192 million in an upsized IPO.");
    expect(deal?.type).toBe("IPO");
  });
});

describe("key facts", () => {
  it("assembles the strip from a realistic readout", () => {
    const body =
      "In the phase 3 ZEUS trial (NCT05021835), ziltivekimab missed its primary endpoint. " +
      "The ORR was 31% and median PFS was 8.4 months (HR 0.94, p=0.31). n = 6,000 patients were randomized.";
    const entities = extractEntities({ title: "Novo Nordisk phase 3 fail", body }, []);
    const facts = buildKeyFacts({
      title: "Novo Nordisk phase 3 fail",
      body,
      entities,
      sourceKind: "news",
      authority: 0.7,
      nctIds: [],
    });

    expect(facts.phase).toMatch(/phase\s?3/i);
    expect(facts.nct).toContain("NCT05021835");
    expect(facts.enrollment).toBe(6000);
    expect(facts.outcome).toBe("missed");
    expect(facts.evidenceLevel).toBe("clinical");
    expect(facts.results.map((r) => r.metric)).toEqual(
      expect.arrayContaining(["ORR", "PFS", "HR", "p"]),
    );
    // Every fact must carry its verbatim source sentence.
    for (const result of facts.results) expect(result.verbatim.length).toBeGreaterThan(10);
  });
});
