// Test suites write to (and the browser suite wipes) the database they are
// given. This guard is the only door: a URL is accepted only if it points at
// this candidate's own PostgreSQL (loopback, port 5433) and at the exact
// disposable database named for that suite. Anything else - unset, the live
// Studio on 5432, another host, another database name - stops the run before
// any test or seed touches it.

export class TestDatabaseError extends Error {}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export const TEST_DB_PORT = "5433";

export function assertDisposableDbUrl(
  raw: string | undefined,
  envName: string,
  database: "fgcand_test" | "fgcand_e2e",
): string {
  if (!raw || !raw.trim()) {
    throw new TestDatabaseError(
      `${envName} is not set. Tests write to this database; export it explicitly (it must be localhost:${TEST_DB_PORT}/${database}).`,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TestDatabaseError(`${envName} is not a valid database URL.`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new TestDatabaseError(`${envName} must be a postgresql:// URL.`);
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new TestDatabaseError(
      `${envName} points at host "${url.hostname}"; only this machine (localhost) is allowed.`,
    );
  }
  if (url.port !== TEST_DB_PORT) {
    throw new TestDatabaseError(
      `${envName} points at port ${url.port || "5432 (default)"}; only ${TEST_DB_PORT} is allowed. Port 5432 is the live Studio.`,
    );
  }
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (name !== database) {
    throw new TestDatabaseError(
      `${envName} points at database "${name}"; only "${database}" is allowed for this suite.`,
    );
  }
  return raw;
}
