import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { routes } from "@/lib/paths";
import "./globals.css";
import "./components.css";

// globals.css has always referenced Inter; nothing ever loaded it until now.
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Biotech Insights",
  description:
    "A daily, deterministically ranked digest of biotech and pharma news, regulatory action, deals and frontier science.",
  // The published Pages site is public even from a private repo, so keep it out
  // of search indexes; the email is the private channel.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <header className="site-header">
          <a className="site-brand" href={routes.home()}>
            Biotech Insights
          </a>
          <nav className="site-nav">
            <a href={routes.home()}>Today</a>
            <a href={routes.archive()}>Archive</a>
            <a href={routes.watchlist()}>Watchlist</a>
            <a href={routes.sources()}>Sources</a>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <span>
            Deterministic keyword ranking, no LLM. Every score is explained in place; tune{" "}
            <code>pipeline/config/weights.json</code>.
          </span>
          <span className="build-stamp">build {process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}</span>
        </footer>
      </body>
    </html>
  );
}
