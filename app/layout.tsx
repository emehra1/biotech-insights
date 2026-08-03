import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Biotech Insights",
  description: "Daily biotech news, translational summaries, and academic paper alerts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
