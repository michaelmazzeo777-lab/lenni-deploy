import Link from "next/link";

const DISCLAIMER =
  "Leonida Field Guide is an independent fan publication and is not affiliated with, endorsed by, sponsored by, or operated by Rockstar Games or Take-Two Interactive. Grand Theft Auto, GTA, GTA VI, Rockstar Games, and related names, marks, characters, footage, and artwork belong to their respective owners. Commentary, criticism, reporting, and analysis are presented for informational and entertainment purposes. Predictions, analysis, rumors, and unverified claims are labeled separately from official facts.";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="public-header">
        <div className="container" style={{ paddingTop: 16, paddingBottom: 16 }}>
          <nav className="public-nav" aria-label="Primary">
            <Link href="/" className="brand">
              Leonida Field Guide
            </Link>
            <Link href="/official-facts">Official Facts</Link>
            <Link href="/guides">Guides</Link>
            <Link href="/corrections">Corrections</Link>
            <Link href="/methodology">Methodology</Link>
            <Link href="/about">About</Link>
          </nav>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.8rem" }}>
            Official evidence. Practical guides. Real experiments. Zero fake leaks.
          </p>
        </div>
      </header>
      <main id="main" className="container">
        {children}
      </main>
      <footer className="container">
        <p className="disclaimer">{DISCLAIMER}</p>
        <p className="muted" style={{ fontSize: "0.75rem" }}>
          An independent fan project. Content is drafted with editorial AI assistance and reviewed
          by humans before publication.
        </p>
      </footer>
    </>
  );
}
