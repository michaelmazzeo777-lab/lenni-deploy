export const metadata = { title: "About — Independent Fan Disclaimer" };

export default function About() {
  return (
    <div className="narrow">
      <h1>About Leonida Field Guide</h1>
      <p>
        Leonida Field Guide is an independent fan publication covering Grand Theft Auto VI through
        careful, evidence-graded guides, analysis, and original experiments.
      </p>
      <h2>Independent fan disclaimer</h2>
      <p className="disclaimer" style={{ borderTop: "none", paddingTop: 0 }}>
        Leonida Field Guide is an independent fan publication and is not affiliated with, endorsed
        by, sponsored by, or operated by Rockstar Games or Take-Two Interactive. Grand Theft Auto,
        GTA, GTA VI, Rockstar Games, and related names, marks, characters, footage, and artwork
        belong to their respective owners. Commentary, criticism, reporting, and analysis are
        presented for informational and entertainment purposes. Predictions, analysis, rumors, and
        unverified claims are labeled separately from official facts.
      </p>
      <p className="muted">
        We do not imitate Rockstar or Take-Two branding, logos, typography, or official-channel
        identity.
      </p>
    </div>
  );
}
