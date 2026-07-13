export const metadata = { title: "Methodology" };

export default function Methodology() {
  return (
    <div className="narrow">
      <h1>Editorial methodology</h1>

      <h2>Source hierarchy</h2>
      <p>
        We prioritize official Rockstar Games and Take-Two publications, then reputable
        corroborating reporting. Community and unverified sources are labeled as such and never
        presented as official.
      </p>

      <h2>Claim labels</h2>
      <ul>
        <li>
          <strong>Confirmed</strong> — stated explicitly by an official source.
        </li>
        <li>
          <strong>Observed</strong> — visible in official material but not explicitly promised.
        </li>
        <li>
          <strong>Analysis</strong> — our editorial interpretation.
        </li>
        <li>
          <strong>Prediction</strong> — a forecast with stated assumptions.
        </li>
        <li>
          <strong>Rumor</strong> — a named third-party claim we have not verified.
        </li>
        <li>
          <strong>Unverified</strong> — insufficient evidence.
        </li>
      </ul>

      <h2>No-leak policy</h2>
      <p>
        We do not use leaked, hacked, or data-mined prerelease material, fake trailers, or deceptive
        thumbnails. Such material is quarantined in our system and cannot enter a published article.
      </p>

      <h2>Corrections policy</h2>
      <p>
        Material errors are corrected publicly. Each correction records the original statement, the
        fix, the reason, and the date, and produces a new immutable article revision.
      </p>

      <h2>AI-assistance disclosure</h2>
      <p>
        We use AI tools to help draft and organize content grounded only in our own reviewed source
        and claim records. Every AI draft is validated and reviewed by a human before publication.
        AI does not publish anything on its own.
      </p>

      <h2>Independence</h2>
      <p>
        Leonida Field Guide is an independent fan publication and is not affiliated with, endorsed
        by, or operated by Rockstar Games or Take-Two Interactive.
      </p>
    </div>
  );
}
