import { getSummary } from "@/lib/summary";
import { InsightSummary } from "@/lib/types";

export const revalidate = 1800;

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

function InfoChip({ children }: { children: React.ReactNode }) {
  return <span className="info-chip">{children}</span>;
}

function ItemCard({ item }: { item: any }) {
  return (
    <article className="card">
      <div className="item-header">
        <div>
          <span className="badge">{item.source}</span>
          <span className="item-date">{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
        </div>
        <span className="item-type">{item.category}</span>
      </div>
      <h3>{item.title}</h3>
      <p className="item-snippet">{item.isAcademic ? item.abstract ?? item.summary : item.executiveSummary ?? item.summary}</p>
      <div className="meta-row">
        {item.drugNames?.length > 0 && (
          <div className="meta-block">
            <span className="meta-label">Drugs:</span>
            {item.drugNames.map((name: string) => (
              <InfoChip key={name}>{name}</InfoChip>
            ))}
          </div>
        )}
        {item.indications?.length > 0 && (
          <div className="meta-block">
            <span className="meta-label">Indications:</span>
            {item.indications.map((indication: string) => (
              <InfoChip key={indication}>{indication}</InfoChip>
            ))}
          </div>
        )}
      </div>
      {item.trialDetails ? <p className="trial-details">{item.trialDetails}</p> : null}
      <div className="tag-row">
        {item.tags?.slice(0, 4).map((tag: string) => (
          <InfoChip key={tag}>{tag}</InfoChip>
        ))}
      </div>
      <a className="read-link" href={item.url} target="_blank" rel="noreferrer">
        Read full item →
      </a>
    </article>
  );
}

export default async function HomePage() {
  const data: InsightSummary = await getSummary();

  return (
    <main>
      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">Biotech Intelligence</span>
          <h1>Daily clinical, deal, and translational research briefing</h1>
          <p>
            A dark-mode intelligence dashboard for biotech deals, platform acquisitions, clinical outcomes, age-related translational
            science, immunology, 3D genome research, single-cell omics, and epigenetics.
          </p>
          <div className="hero-tags">
            <InfoChip>Endpoint coverage</InfoChip>
            <InfoChip>Fierce Biotech alerts</InfoChip>
            <InfoChip>Recent papers only</InfoChip>
            <InfoChip>Drug/indication extraction</InfoChip>
          </div>
        </div>
      </section>

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <h2>Top headlines</h2>
            <p>Latest biotech news, fast clinical readouts, and translational paper summaries pulled from free feeds.</p>
          </div>
          <span className="section-note">Updated daily</span>
        </div>
        <div className="summary-grid">
          {data.overview.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      {data.categories.map((group) => (
        <section key={group.name}>
          <div className="section-heading">
            <div>
              <h2>{group.name}</h2>
              <p>{group.description}</p>
            </div>
            <span className="section-note">{group.items.length} items</span>
          </div>
          <div className="grid grid-2">
            {group.items.length > 0 ? (
              group.items.map((item) => <ItemCard key={item.id} item={item} />)
            ) : (
              <div className="card empty-card">
                <p>No recent coverage in this category yet. The scanner is pulling the latest journal and news feeds.</p>
              </div>
            )}
          </div>
        </section>
      ))}

      <section className="footer-panel">
        <div className="footer-card">
          <h2>Why this dashboard?</h2>
          <p>
            This interface is designed to move beyond headlines and surface drug names, indications, PK/PD signals, clinical trial
            context, and paper abstracts in a single view.
          </p>
        </div>
      </section>
    </main>
  );
}
