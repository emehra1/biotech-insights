import { describe, expect, it } from "vitest";

import { clusterItems, type ClusterCandidate } from "../pipeline/cluster";
import { extractEntities } from "../pipeline/extract/entities";
import { isoWeek, parseFeedDate, wallClockToUtc } from "../pipeline/normalize/dates";
import { htmlToText, stripJournalBoilerplate } from "../pipeline/normalize/html";
import { splitSentences, sentenceAround } from "../pipeline/normalize/sentences";
import { cleanText } from "../pipeline/normalize/text";
import { canonicalizeUrl } from "../pipeline/normalize/url";
import { summarize } from "../pipeline/summarize";

describe("feed text coercion", () => {
  it("unwraps the anchor object Fierce puts inside <title>", () => {
    // This exact shape crashed the old pipeline: .replace() on an object.
    const fierceTitle = {
      a: [
        {
          _: "Novo Nordisk left praying to Artemis and Hermes to salvage CKD program after phase 3 fail",
          $: { href: "/biotech/novo-nordisk-left-praying", hreflang: "en" },
        },
      ],
    };
    expect(cleanText(fierceTitle)).toBe(
      "Novo Nordisk left praying to Artemis and Hermes to salvage CKD program after phase 3 fail",
    );
  });

  it("passes plain strings through and never yields [object Object]", () => {
    expect(cleanText("Plain title")).toBe("Plain title");
    expect(cleanText({ _: "Nested" })).toBe("Nested");
    expect(cleanText(null)).toBe("");
    expect(cleanText({ a: [{ _: "x" }] })).not.toContain("[object");
  });
});

describe("date parsing", () => {
  it("parses the Fierce format that V8 rejects outright", () => {
    // new Date("Jul 31, 2026 8:59am") === Invalid Date
    expect(Number.isNaN(new Date("Jul 31, 2026 8:59am").getTime())).toBe(true);

    const parsed = parseFeedDate("Jul 31, 2026 8:59am", {
      assumeTimeZone: "America/New_York",
      now: new Date("2026-08-02T00:00:00Z"),
    });
    // 08:59 EDT (UTC-4) === 12:59Z
    expect(parsed.date?.toISOString()).toBe("2026-07-31T12:59:00.000Z");
    expect(parsed.confident).toBe(true);
  });

  it("handles the EST/EDT boundary correctly", () => {
    // January is EST (UTC-5), so 08:59 local is 13:59Z, not 12:59Z.
    const winter = parseFeedDate("Jan 15, 2026 8:59am", {
      assumeTimeZone: "America/New_York",
      now: new Date("2026-01-20T00:00:00Z"),
    });
    expect(winter.date?.toISOString()).toBe("2026-01-15T13:59:00.000Z");
  });

  it("anchors date-only values at noon UTC so the day survives any timezone", () => {
    const parsed = parseFeedDate("2026-08-03");
    expect(parsed.date?.toISOString()).toBe("2026-08-03T12:00:00.000Z");
    expect(parsed.precision).toBe("day");
  });

  it("parses RFC-822 with a named zone (FDA)", () => {
    const parsed = parseFeedDate("Wed, 29 Jul 2026 12:10:31 EDT");
    expect(parsed.date?.toISOString()).toBe("2026-07-29T16:10:31.000Z");
  });

  it("returns null rather than inventing a date", () => {
    const parsed = parseFeedDate("not a date at all");
    expect(parsed.date).toBeNull();
    expect(parsed.confident).toBe(false);
  });

  it("clamps implausible future dates instead of trusting the feed", () => {
    const now = new Date("2026-08-03T00:00:00Z");
    const parsed = parseFeedDate("2027-01-01T00:00:00Z", { now });
    expect(parsed.date!.getTime()).toBeLessThan(new Date("2026-08-05T00:00:00Z").getTime());
    expect(parsed.confident).toBe(false);
  });

  it("converts wall clock to UTC across a DST transition", () => {
    expect(wallClockToUtc("America/New_York", 2026, 6, 31, 8, 59).toISOString()).toBe(
      "2026-07-31T12:59:00.000Z",
    );
  });

  it("computes ISO weeks", () => {
    expect(isoWeek(new Date("2026-08-03T12:00:00Z"))).toMatch(/^2026-W\d{2}$/);
  });
});

describe("url canonicalization", () => {
  it("strips the tracking params each source adds", () => {
    expect(
      canonicalizeUrl("https://www.statnews.com/2026/08/02/senate-measure/?utm_campaign=rss"),
    ).toBe("https://www.statnews.com/2026/08/02/senate-measure");
    expect(canonicalizeUrl("https://www.biorxiv.org/content/10.1101/2026.1v1?rss=1")).toBe(
      "https://www.biorxiv.org/content/10.1101/2026.1v1",
    );
    expect(canonicalizeUrl("https://www.cell.com/cell/fulltext/S0092?rss=yes")).toBe(
      "https://www.cell.com/cell/fulltext/S0092",
    );
  });

  it("upgrades FDA http links and rewrites the endpts.com alias", () => {
    expect(canonicalizeUrl("http://www.fda.gov/news-events/press-announcements/x")).toBe(
      "https://www.fda.gov/news-events/press-announcements/x",
    );
    expect(canonicalizeUrl("https://endpts.com/some-story/")).toBe(
      "https://endpoints.news/some-story",
    );
  });

  it("treats trailing-slash variants as one item", () => {
    expect(canonicalizeUrl("https://x.com/a/b/")).toBe(canonicalizeUrl("https://x.com/a/b"));
  });
});

describe("html handling", () => {
  it("drops the leading figure/img block BioPharma Dive puts in description", () => {
    const description =
      '&lt;figure&gt;&lt;div&gt;&lt;img src="https://imgproxy.divecdn.com/abc.webp"/&gt;&lt;/div&gt;&lt;/figure&gt;&lt;p&gt;Ziltivekimab&amp;#39;s failure in a key trial spurred share sell-offs.&lt;/p&gt;';
    const text = htmlToText(description);
    expect(text).not.toContain("imgproxy");
    expect(text).toContain("Ziltivekimab's failure in a key trial spurred share sell-offs.");
  });

  it("keeps words apart across block boundaries", () => {
    expect(htmlToText("<p>First sentence.</p><p>Second sentence.</p>")).toBe(
      "First sentence. Second sentence.",
    );
  });

  it("strips the Nature publication boilerplate", () => {
    const encoded = htmlToText(
      '<p>Nature, Published online: 03 August 2026; <a href="x">doi:10.1038/d41586-026-02339-1</a></p>A combination of drugs restores stem-cell function in mouse models.',
    );
    expect(stripJournalBoilerplate(encoded)).toBe(
      "A combination of drugs restores stem-cell function in mouse models.",
    );
  });
});

describe("sentence handling", () => {
  it("keeps statistics inside one sentence", () => {
    const sentences = splitSentences(
      "Ziltivekimab missed its primary endpoint (HR 0.94, p=0.31; n=6,000). Analysts had expected more.",
    );
    expect(sentences).toHaveLength(2);
    expect(sentences[0]).toContain("p=0.31");
  });

  it("does not split on common abbreviations", () => {
    expect(splitSentences("Ying Huang, Ph.D., has left the company. A successor is pending.")).toHaveLength(
      2,
    );
  });

  it("quotes a whole sentence, not a fragment after a decimal point", () => {
    const text = "The trial read out. Median PFS was 8.4 months (HR 0.94, p=0.31). It was a miss.";
    const quote = sentenceAround(text, text.indexOf("p=0.31"));
    expect(quote).toContain("Median PFS");
    expect(quote.length).toBeGreaterThan(20);
  });
});

describe("story clustering", () => {
  /**
   * The real pair from these feeds. Title similarity is near zero (token
   * Jaccard 0.056), so only the shared drug entity can link them — this test
   * exists to stop anyone "simplifying" clustering back to title-only.
   */
  const makeCandidate = (
    id: string,
    title: string,
    body: string,
    publisherGroup: string,
  ): ClusterCandidate => ({
    id,
    title,
    canonicalUrl: `https://example.com/${id}`,
    publisherGroup,
    publishedAt: new Date("2026-07-31T12:00:00Z"),
    entities: extractEntities({ title, body }, []),
    authority: 0.75,
    bodyLength: body.length,
    sourceKind: "news",
  });

  it("merges the same story across two outlets that share no headline words", () => {
    const fierce = makeCandidate(
      "a",
      "Novo Nordisk left praying to Artemis and Hermes to salvage CKD program after phase 3 fail",
      "A phase 3 trial of Novo Nordisk's ziltivekimab has missed its primary endpoint, denting the prospects of the drug.",
      "questex",
    );
    const dive = makeCandidate(
      "b",
      "Novo setback casts doubt on a new way to treat heart disease",
      "Ziltivekimab's failure in a key trial spurred share sell-offs for Novo and other biotechs.",
      "industrydive",
    );

    const { clusters } = clusterItems([fierce, dive]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.memberIds.sort()).toEqual(["a", "b"]);
    expect(clusters[0]?.publisherCount).toBe(2);
  });

  it("does not merge unrelated stories that share a common company", () => {
    const a = makeCandidate(
      "a",
      "Novo Nordisk names new chief financial officer",
      "Novo Nordisk said its CFO will step down at the end of the year.",
      "questex",
    );
    const b = makeCandidate(
      "b",
      "Novo Nordisk opens a manufacturing site in North Carolina",
      "Novo Nordisk will invest in a new fill-finish facility.",
      "industrydive",
    );
    expect(clusterItems([a, b]).clusters).toHaveLength(2);
  });

  it("counts one publisher when the same newsroom runs two versions", () => {
    const a = makeCandidate("a", "Ziltivekimab misses in phase 3", "Novo Nordisk ziltivekimab missed.", "questex");
    const b = makeCandidate("b", "Ziltivekimab misses phase 3 endpoint", "Novo Nordisk ziltivekimab missed.", "questex");
    const { clusters } = clusterItems([a, b]);
    expect(clusters[0]?.publisherCount).toBe(1);
  });
});

describe("summarization", () => {
  it("returns a short dek verbatim rather than pretending to summarize", () => {
    const dek = "Legend Biotech CEO Ying Huang has left the company suddenly, without a successor.";
    const result = summarize({
      title: "Legend CEO departs",
      body: dek,
      provenance: "dek",
      lane: "business-deals",
      entities: extractEntities({ title: "Legend CEO departs", body: dek }, []),
    });
    expect(result.source).toBe("dek");
    expect(result.digest).toEqual([dek]);
  });

  it("selects result-bearing sentences and keeps document order", () => {
    const body = [
      "The company announced results from its pivotal study today.",
      "Chief executive Jane Doe said the team was thrilled with the outcome.",
      "The trial met its primary endpoint with an objective response rate of 42%.",
      "Median progression-free survival was 11.2 months versus 6.1 months for placebo.",
      "The company plans to file with regulators later this year.",
    ].join(" ");

    const result = summarize({
      title: "Pivotal study readout",
      body,
      provenance: "content:encoded",
      lane: "clinical-regulatory",
      entities: extractEntities({ title: "Pivotal study readout", body }, []),
      maxSentences: 2,
    });

    expect(result.source).toBe("extractive");
    const joined = result.digest.join(" ");
    expect(joined).toMatch(/42%|11\.2 months/);
    // Document order preserved: the ORR sentence precedes the PFS sentence.
    if (joined.includes("42%") && joined.includes("11.2 months")) {
      expect(joined.indexOf("42%")).toBeLessThan(joined.indexOf("11.2 months"));
    }
  });

  it("prefers labelled Results/Conclusions sections in a structured abstract", () => {
    const body =
      "Background: Aging drives disease. Methods: We enrolled 200 participants and measured methylation. " +
      "Results: Epigenetic age acceleration was 2.1 years higher in the exposed group (p=0.004). " +
      "Conclusions: Exposure associates with accelerated biological aging in this cohort.";
    const result = summarize({
      title: "Methylation study",
      body,
      provenance: "abstract",
      lane: "aging-omics",
      entities: extractEntities({ title: "Methylation study", body }, []),
    });
    expect(result.source).toBe("abstract");
    expect(result.digest.join(" ")).toContain("2.1 years");
    expect(result.digest.join(" ")).not.toContain("We enrolled 200 participants");
  });
});
