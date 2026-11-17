import { describe, it, expect } from "vitest";
import { assertDisposableDbUrl, TestDatabaseError } from "@/lib/testing/db-guard";

const ok = "postgresql://postgres:postgres@localhost:5433/fgcand_test";
const check = (url: string | undefined, db: "fgcand_test" | "fgcand_e2e" = "fgcand_test") =>
  assertDisposableDbUrl(url, "TEST_DATABASE_URL", db);

describe("assertDisposableDbUrl", () => {
  it("accepts the candidate's disposable database on loopback:5433", () => {
    expect(check(ok)).toBe(ok);
    expect(check("postgresql://postgres:postgres@127.0.0.1:5433/fgcand_test")).toBeTruthy();
    expect(check("postgres://postgres@[::1]:5433/fgcand_e2e", "fgcand_e2e")).toBeTruthy();
  });

  it("refuses a missing or blank URL", () => {
    expect(() => check(undefined)).toThrow(TestDatabaseError);
    expect(() => check("   ")).toThrow(/is not set/);
  });

  it("refuses the live Studio's port 5432, explicit or default", () => {
    expect(() => check("postgresql://postgres:postgres@localhost:5432/fgcand_test")).toThrow(
      /port 5432.*live Studio/,
    );
    expect(() => check("postgresql://postgres:postgres@localhost/fgcand_test")).toThrow(
      /5432 \(default\)/,
    );
  });

  it("refuses the live database name even on the right port", () => {
    expect(() => check("postgresql://postgres:postgres@localhost:5433/fieldguide")).toThrow(
      /"fieldguide"/,
    );
  });

  it("refuses the other suite's database", () => {
    expect(() => check(ok, "fgcand_e2e")).toThrow(/only "fgcand_e2e"/);
  });

  it("refuses a remote host", () => {
    expect(() => check("postgresql://postgres:postgres@db.example.com:5433/fgcand_test")).toThrow(
      /only this machine/,
    );
  });

  it("refuses something that is not a postgres URL", () => {
    expect(() => check("not a url")).toThrow(/not a valid/);
    expect(() => check("mysql://root@localhost:5433/fgcand_test")).toThrow(/postgresql:\/\//);
  });
});
