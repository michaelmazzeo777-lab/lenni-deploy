// Small shared presentational helpers (server components).

export function Banner({ error, ok }: { error?: string; ok?: string }) {
  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="notice" role="status">
          {ok}
        </p>
      ) : null}
    </>
  );
}

export function Badge({ kind, label }: { kind: string; label?: string }) {
  return <span className={`badge ${kind}`}>{label ?? kind.replace(/_/g, " ")}</span>;
}

export function humanStatus(s: string): string {
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
