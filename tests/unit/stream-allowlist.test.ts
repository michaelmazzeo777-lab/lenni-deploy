import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  decideAllowlist,
  loadAllowlist,
  matchAllowlist,
  EMPTY_ALLOWLIST,
  type Allowlist,
} from "@/lib/clipper/allowlist";

const listWith = (channels: Allowlist["channels"]): Allowlist => ({ version: 1, channels });

function tmpJson(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "allowlist-"));
  const p = path.join(dir, "allowlist.json");
  writeFileSync(p, contents);
  return p;
}

describe("allowlist loading", () => {
  it("treats a missing file as allowing nothing, not as an error", () => {
    expect(loadAllowlist(path.join(tmpdir(), "definitely-absent-allowlist.json"))).toEqual(
      EMPTY_ALLOWLIST,
    );
  });

  it("refuses malformed JSON rather than falling back to permissive", () => {
    expect(() => loadAllowlist(tmpJson("{ not json"))).toThrow(/not valid JSON/i);
  });

  it("refuses a file whose shape is wrong, naming the field", () => {
    const p = tmpJson(JSON.stringify({ version: 1, channels: [{ platform: "myspace" }] }));
    expect(() => loadAllowlist(p)).toThrow(/channels/);
  });

  it("rejects unknown keys so a typo cannot silently do nothing", () => {
    const p = tmpJson(
      JSON.stringify({
        version: 1,
        channels: [{ platform: "youtube", channelName: "X", chanelId: "UC1" }],
      }),
    );
    expect(() => loadAllowlist(p)).toThrow();
  });

  it("loads the repo's real allowlist and it is structurally valid", () => {
    // Asserts the file is loadable and well-shaped, NOT what is in it. The
    // owner edits that file; a test that pinned its contents would fail the
    // moment a channel was legitimately added.
    const real = loadAllowlist(path.join(process.cwd(), "config", "allowlist.json"));
    expect(real.version).toBe(1);
    expect(Array.isArray(real.channels)).toBe(true);
    for (const c of real.channels) {
      expect(c.channelName.trim().length).toBeGreaterThan(0);
      expect(["youtube", "twitch", "kick"]).toContain(c.platform);
    }
  });

  it("refuses a channel the real allowlist does not name, whatever it contains", () => {
    // The invariant that matters: refusal is the default. Holds with an empty
    // file and with any number of approved channels in it.
    const real = loadAllowlist(path.join(process.cwd(), "config", "allowlist.json"));
    const d = decideAllowlist(
      {
        platform: "youtube",
        channelName: "zz-not-an-approved-channel-7f3a9c",
        channelId: "UCzz-not-approved-7f3a9c",
        channelHandle: "zz-not-approved-7f3a9c",
      },
      {},
      real,
    );
    expect(d.allowed).toBe(false);
    expect(d.entry).toBeNull();
  });

  it("refuses everything when the file on disk is an empty allowlist", () => {
    // The empty case, on a throwaway copy rather than the owner's real file.
    const p = tmpJson(JSON.stringify({ version: 1, channels: [] }));
    const loaded = loadAllowlist(p);
    expect(loaded.channels).toEqual([]);
    const d = decideAllowlist({ platform: "youtube", channelName: "Anyone At All" }, {}, loaded);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/allowlist is empty/i);
  });
});

describe("decideAllowlist — deny by default", () => {
  const subject = {
    platform: "youtube" as const,
    channelName: "Some Streamer",
    channelId: "UCabc123",
  };

  it("refuses everything when the list is empty, and says why", () => {
    const d = decideAllowlist(subject, {}, EMPTY_ALLOWLIST);
    expect(d.allowed).toBe(false);
    expect(d.entry).toBeNull();
    expect(d.reason).toMatch(/allowlist is empty/i);
  });

  it("refuses a channel that is not listed, even when others are", () => {
    const list = listWith([{ platform: "youtube", channelName: "Someone Else" }]);
    const d = decideAllowlist(subject, {}, list);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/not on the clipping allowlist/i);
  });

  it("refuses --allow-unlisted when no approver is recorded", () => {
    const d = decideAllowlist(subject, { allowUnlisted: true }, EMPTY_ALLOWLIST);
    expect(d.allowed).toBe(false);
    expect(d.unlistedApprovedBy).toBeNull();
    expect(d.reason).toMatch(/requires the owner's approval/i);
  });

  it("refuses --allow-unlisted when the approver is blank whitespace", () => {
    const d = decideAllowlist(subject, { allowUnlisted: true, approvedBy: "   " }, EMPTY_ALLOWLIST);
    expect(d.allowed).toBe(false);
  });

  it("allows an unlisted channel only with a recorded approver", () => {
    const d = decideAllowlist(
      subject,
      { allowUnlisted: true, approvedBy: "user_mike" },
      EMPTY_ALLOWLIST,
    );
    expect(d.allowed).toBe(true);
    expect(d.unlistedApprovedBy).toBe("user_mike");
    expect(d.reason).toMatch(/allowed for this run by user_mike/);
  });

  it("allows a listed channel and reports which entry matched", () => {
    const list = listWith([
      { platform: "youtube", channelName: "Some Streamer", channelId: "UCabc123" },
    ]);
    const d = decideAllowlist(subject, {}, list);
    expect(d.allowed).toBe(true);
    expect(d.entry?.channelName).toBe("Some Streamer");
    expect(d.unlistedApprovedBy).toBeNull();
  });
});

describe("matchAllowlist — identifier precedence", () => {
  it("does not match across platforms", () => {
    const list = listWith([{ platform: "twitch", channelName: "Some Streamer" }]);
    expect(matchAllowlist({ platform: "youtube", channelName: "Some Streamer" }, list)).toBeNull();
  });

  it("matches on channel id even when the display name has changed", () => {
    const list = listWith([
      { platform: "youtube", channelName: "Old Name", channelId: "UCabc123" },
    ]);
    const m = matchAllowlist(
      { platform: "youtube", channelName: "Brand New Name", channelId: "UCabc123" },
      list,
    );
    expect(m?.channelId).toBe("UCabc123");
  });

  it("matches on handle when no id is known, case-insensitively", () => {
    const list = listWith([
      { platform: "twitch", channelName: "Some Streamer", channelHandle: "SomeStreamer" },
    ]);
    expect(
      matchAllowlist({ platform: "twitch", channelHandle: "somestreamer" }, list),
    ).not.toBeNull();
  });

  it("does not match a different channel that merely shares a handle prefix", () => {
    const list = listWith([
      { platform: "twitch", channelName: "Some Streamer", channelHandle: "somestreamer" },
    ]);
    expect(matchAllowlist({ platform: "twitch", channelHandle: "somestreamer2" }, list)).toBeNull();
  });
});
