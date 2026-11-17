import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { FUNCTIONS, OFFICIAL_HOSTS, PLATFORMS } from "@/lib/platforms/capabilities";

describe("platform capability matrix", () => {
  it("covers all five platforms and all ten functions", () => {
    expect(PLATFORMS.map((p) => p.key).sort()).toEqual(
      ["facebook", "instagram", "tiktok", "twitch", "youtube"].sort(),
    );
    for (const p of PLATFORMS) {
      for (const f of FUNCTIONS) {
        expect(p.capabilities[f.key], `${p.key}.${f.key}`).toBeTruthy();
        expect(p.capabilities[f.key].note.length).toBeGreaterThan(10);
      }
    }
  });

  it("never claims a connection, upload, scheduling or publication is working in the Studio", () => {
    for (const p of PLATFORMS) {
      for (const k of [
        "connection",
        "upload",
        "scheduling",
        "publication",
        "accountMetadata",
      ] as const) {
        expect(p.capabilities[k].outcome, `${p.key}.${k}`).not.toBe("IMPLEMENTED_LOCAL");
      }
      expect(p.capabilities.publication.outcome).toBe("NOT_SUPPORTED");
      expect(p.capabilities.footageAccess.outcome).toBe("NOT_SUPPORTED");
    }
  });

  it("links only to the platforms' own official sites", () => {
    for (const p of PLATFORMS) {
      for (const u of [p.manualDestination, ...p.sources.map((s) => s.url)]) {
        const url = new URL(u);
        expect(url.protocol).toBe("https:");
        expect(OFFICIAL_HOSTS, u).toContain(url.hostname);
      }
    }
  });
});

// A16: no code path in the app talks to a platform's upload or OAuth endpoints.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("no live platform integration in the source", () => {
  it("has no OAuth token exchange or upload endpoint anywhere in app, domain or lib", () => {
    const banned = [
      /oauth2\.googleapis\.com\/token/,
      /googleapis\.com\/upload\/youtube/,
      /graph\.facebook\.com/,
      /open\.tiktokapis\.com/,
      /id\.twitch\.tv\/oauth2\/token/,
    ];
    for (const f of ["app", "domain", "lib"].flatMap((d) => files(path.resolve(d)))) {
      const text = readFileSync(f, "utf8");
      for (const b of banned) expect(text, `${f} matches ${b}`).not.toMatch(b);
    }
  });
});
