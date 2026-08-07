# Biotech Insights

A daily biotech/pharma intelligence digest that runs itself on free GitHub
infrastructure. A scheduled Action pulls 27 sources, ranks everything with a
transparent scoring model, commits the result to this repo, publishes a static
site to GitHub Pages, and emails you the digest.

**No LLM is involved.** Ranking is a deterministic weighted sum, and every item
shows its own score breakdown — with no model to trust, explainability is the
trust mechanism.

---

## Quick start

```bash
npm install
npm run pipeline -- --dry-run   # fetch + rank, write nothing
npm run pipeline                # write data/digests/<year>/<date>.json
npm run dev                     # http://localhost:3000
npm run email -- --date $(date +%F)   # preview the email; sends nothing
```

Nothing above needs configuration. Sending mail needs SMTP credentials and an
explicit `--send`.

## Publishing (one-time setup)

1. **Create the repo on GitHub** and push `main`. GitHub Pages needs a *public*
   repo on the Free plan; GitHub Pro (free for students via the Student
   Developer Pack) allows a private repo — the published site is public either
   way.
2. **Settings → Pages → Source: GitHub Actions.** (`configure-pages` also sets
   this on the first run, but doing it by hand avoids a confusing first failure.)
3. **Settings → Secrets and variables → Actions** — add `SMTP_HOST`,
   `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_TO`. Gmail needs
   an App Password with 2-Step Verification on; ports 465 or 587 only, because
   port 25 is blocked on GitHub runners.
4. **Actions → Digest pipeline → Run workflow** with `force: true` to prove it
   end to end. That first run is also the real test of whether the runner's IP
   can reach every publisher — a feed that 403s from CI but works locally is a
   WAF blocking datacenter IPs, and the fix is source-level, not code.
5. **Edit `config/watchlist.yml`** with the companies, drugs and targets you
   actually follow. This is the single highest-leverage input.

After that it runs at 11:17 UTC daily, rolls up weekly on Sundays, and emails
you each morning.

## How it works

```
Action (cron / dispatch)
  ingest    fetch → parse → normalize      pipeline/net, pipeline/ingest
  extract   drugs, companies, trials, deals pipeline/extract
  cluster   near-duplicate story merging    pipeline/cluster
  score     explainable weighted sum        pipeline/score
  summarize sentence selection + key facts  pipeline/summarize
  emit      data/digests/YYYY/*.json        committed — the repo is the database
  build     next build → out/               static export
  deploy    upload-pages-artifact → Pages
  email     escaped HTML + text part        lib/email
```

### Ranking

```
score = authority + recency + topic match + event boost + corroboration
        + watchlist + fact density − penalties
```

- **Recency** decays exponentially with a half-life set per topic (20h for
  clinical news, 96h for aging research), so a big story survives into day two
  and day-three filler does not.
- **Topic match** saturates (`x / (x + K)`) with diminishing returns per repeated
  term, so an article can be strongly on-topic without swamping the scale.
- **Corroboration** counts *publisher groups*, not sources — Fierce Biotech and
  Fierce Pharma are one newsroom, so "covered by 3 outlets" means three.
- **Penalties** cover thin content, reviews, in-vitro-only work and
  non-mammalian models. Without the last one, a honeybee mitophagy paper
  outranks the day's biggest merger on keyword match alone.
- **Off-topic** penalises an item that matched no lexicon term in any lane.
  Authority plus recency alone is worth ~33 against a keep threshold of 24, so
  without this a high-authority source publishing anything at all cleared the
  bar on provenance rather than relevance — a Nature Futures short story and an
  astrophysics news item both made the digest that way.
- **Stale repeat** penalises an item a digest in the last week already
  delivered. Keyed on *delivered*, not on the seen store: most items are seen
  and then dropped by a cap, and penalising those would permanently bury
  everything a productive source could not fit into its slots on day one.

Tune any of it in `pipeline/config/weights.json` — no code change needed.

### Where papers come from

The journal allowlist is closed, and lives in `pipeline/config/journals.ts`:
**Nature, Cell, Science, NEJM, The Lancet, JAMA and bioRxiv/medRxiv**, plus
their sub-journals. Nothing else — an earlier keyword-across-all-of-Europe-PMC
source is what put *Computational Biology and Chemistry* and *Advanced Materials
(Deerfield Beach, Fla.)* in a biotech digest.

Each family's high-volume open-access title is excluded on volume alone: Nature
Communications (~80 papers/day), Science Advances (208 records/14d), JAMA Network
Open, Cell Reports and Cell Reports Medicine, Current Biology, Cell Systems. Any
one of them would spend a source's whole daily allowance before its flagship was
reached.

**Every paper is credited to the journal that published it**, never to the index
it was read through — `pipeline/config/journals.ts` also holds the canonical
display name for each title, because the raw NLM catalogue form is "Cell stem
cell" and "Lancet (London, England)".

Routing is decided by who will actually serve a machine, and that part is not
negotiable:

- **Springer Nature** — direct RSS (`nature.com/*.rss`), same-day, and the
  sub-journal feeds carry real editor's-summary abstracts. Note that
  `nature.rss` is 59% newsroom: a live pull was 44 `d41586` items (News, News &
  Views, Careers, Books & Arts, Futures fiction) against 31 `s41586` research
  articles. `pipeline/extract/article-class.ts` tells them apart by the DOI
  prefix, so "it appeared in Nature" no longer scores a book review as a
  landmark paper.

  These feeds need a cookie jar, which is why `pipeline/net/cookies.ts` exists.
  When nature.com's edge cache misses, it answers a cookie-less client with a
  303 into `idp.nature.com`, which mints an anonymous session and bounces you
  back — and on 2026-08-07 that bounce returned a Fastly bot-management
  challenge page (HTTP 200, `text/html`) for 8 of 11 feeds from the runner.
  Keeping the session it hands out collapses the whole thing to one bounce per
  run. Do not "optimise" it by inventing a cookie value: the IdP does not check
  them today, and fabricating a session to skirt a mechanism the publisher is
  deliberately running is a different thing from accepting one it offered.
- **Cell Press, Lancet, Science, NEJM, JAMA's specialty titles** — via Europe
  PMC, one source per family so each gets its own daily allowance. Their own
  feeds return 403 to datacenter IPs, and that is enforcement rather than an
  obstacle: `nejm.org/robots.txt` disallows both `/action` and `/rss`,
  science.org and thelancet.com disallow `/action`, and Elsevier serves
  `tdm-reservation: 1` on the cell.com feeds. Europe PMC is the licensed index
  that says yes, and it returns abstracts, which the publisher RSS does not.
- **JAMA itself and bioRxiv/medRxiv** — direct RSS, which works.

No family is reachable by two routes, and that is deliberate: the same paper
arriving as `nature.com/articles/…` and `doi.org/10.1038/…` is two different
canonical URLs, and the deduper cannot merge them. It is why JAMA is absent from
the Europe PMC query that covers JAMA Oncology and the rest.

Two things about the Europe PMC queries are easy to get wrong and are commented
in `pipeline/config/sources.ts`: the window has to be ~14 days (deposit lag runs
1–9 days per journal, and index dates arrive in bursts with empty days between),
and `HAS_ABSTRACT:Y` is what removes the News, Letters, Comments and errata that
otherwise make up three quarters of the matches. Beware also that `PUB_DATE`,
`EPUB_DATE` and `INDEXED_DATE` are not Europe PMC fields — they return HTTP 200
with zero hits and no error, so a plausible-looking edit can silently kill a
source.

### Clustering

Entity-first, not title-first. The two real stories

> "Novo Nordisk left praying to Artemis and Hermes to salvage CKD program after phase 3 fail" (Fierce)
> "Novo setback casts doubt on a new way to treat heart disease" (BioPharma Dive)

are the same ziltivekimab readout, but their title token overlap is 0.056 — only
the shared drug name links them. Title similarity is kept as a secondary signal
for verbatim wire syndication. There is a test for exactly this pair.

## Commands

| Command | What it does |
| --- | --- |
| `npm run pipeline` | Fetch, rank and write today's digest |
| `npm run pipeline -- --dry-run` | Same, writing nothing; prints the top 15 with score breakdowns |
| `npm run pipeline -- --from-cache` | Replay the last fetch with zero network — the fast loop for tuning |
| `npm run pipeline -- --only=fierce-biotech,endpoints` | Restrict to some sources |
| `npm run weekly` | Build the weekly rollup |
| `npm run email` | Preview the email to `.preview/` |
| `npm run email -- --send` | Actually send it |
| `npx tsx scripts/check-sources.ts` | Per-source health check — run this when the digest looks thin |
| `npm test` | Vitest, including the extraction negative corpus |
| `npm run validate` | Schema-check everything under `data/` |

## Repo layout

```
pipeline/     the whole ingestion → digest pipeline (never imported by the site,
              so Next never bundles cheerio or rss-parser)
  config/     sources.ts, lanes.ts, weights.json  ← tune here
  lexicon/    INN stems, companies, indications, modalities, targets
lib/          shared types + browser-safe helpers + the email renderer
app/          static-export Next site
components/   typed UI
config/       watchlist.yml — the file you actually edit
data/         committed digests, weekly rollups and state. The database.
tests/        including a 15-sentence corpus that must yield ZERO drug names
```

## Maintenance

Two things rot on their own:

- **Feeds.** Four of this project's original ten endpoints had already died
  silently. `scripts/check-sources.ts` and the `/sources` page exist so you
  notice within a day rather than a month.
- **Lexicons.** Companies rebrand and new INNs appear monthly. Each run writes
  `data/unknown-entities.json` — capitalized phrases that look corporate but
  aren't in the dictionary, ranked by frequency. Five minutes a week promoting
  entries from there into `pipeline/lexicon/index.ts` is the maintenance cost of
  choosing keyword extraction over a model.

## Known limits

- Keyword ranking reliably identifies *what kind of event* happened and *who is
  involved*. It cannot tell you whether a result is scientifically surprising.
- The Pages site is publicly readable even from a private repo, so anything in
  `config/watchlist.yml` is public. **`WATCHLIST_PRIVATE` is not implemented
  yet** — the secret is wired into the email job, but the only code that reads it
  runs in the `build` job, so private terms currently do nothing. Moving the
  secret is not the fix: `build` produces the digest that gets committed and
  published, so the private terms would ship in `data/digests/`. Doing it
  properly means matching the private watchlist inside `scripts/send-email.ts`,
  against the already-built digest.
- GitHub cron drifts by tens of minutes and occasionally skips. The ingest
  window is "since the last digest", never a fixed 24 hours, so a late run just
  widens the window.
- No on-demand refresh from the UI — it is a static site. Use
  `gh workflow run pipeline.yml -f force=true`.
