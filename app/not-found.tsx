import { routes } from "@/lib/paths";

/** Emitted as out/404.html, which GitHub Pages serves for any unknown path. */
export default function NotFound() {
  return (
    <main>
      <section className="hero-panel">
        <div className="hero-card">
          <span className="eyebrow">404</span>
          <h1>No page here</h1>
          <p>
            That digest may not have been generated — the pipeline writes a file only on days it
            runs successfully, so gaps in the archive are real.
          </p>
          <div className="hero-links">
            <a href={routes.home()}>Today’s digest</a>
            <a href={routes.archive()}>Archive</a>
          </div>
        </div>
      </section>
    </main>
  );
}
