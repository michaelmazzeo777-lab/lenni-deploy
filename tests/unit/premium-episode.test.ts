import { describe, it, expect } from "vitest";
import { buildEpisode, headlineLines, MAX_PHRASE_CHARS, splitPhrases } from "@/lib/premium/episode";

const card = (label: string, value: string, note: string) => ({ label, value, note });

describe("caption phrases for the premium engine", () => {
  it("breaks after punctuation and keeps every word, in order", () => {
    const line = "The first boat leaves at six in the morning, and the last one at midnight.";
    const parts = splitPhrases(line);
    expect(parts).toEqual([
      "The first boat leaves at six in the morning,",
      "and the last one at midnight.",
    ]);
    expect(parts.join(" ")).toBe(line);
  });

  it("splits a long clause near its middle and never exceeds the caption width", () => {
    const line =
      "Rangers ask every visitor to sign the logbook at the lower gate before starting their walk up the ridge.";
    const parts = splitPhrases(line);
    expect(parts.join(" ")).toBe(line);
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_PHRASE_CHARS);
  });

  it("joins a fragment too short to stand alone to its neighbour", () => {
    expect(splitPhrases("No rumors. No invented gameplay.")).toEqual([
      "No rumors. No invented gameplay.",
    ]);
    expect(splitPhrases("Yes, it is confirmed by the publisher today.")).toEqual([
      "Yes, it is confirmed by the publisher today.",
    ]);
  });

  it("leaves a single over-long word whole rather than cutting it", () => {
    const word = "x".repeat(60);
    expect(splitPhrases(word)).toEqual([word]);
  });
});

describe("headline lines", () => {
  it("puts a short statement on one line and splits a longer one near the middle", () => {
    expect(headlineLines("Free entry")).toEqual(["FREE ENTRY", ""]);
    expect(headlineLines("Six to midnight")).toEqual(["SIX TO", "MIDNIGHT"]);
    expect(headlineLines("Every twenty minutes")).toEqual(["EVERY TWENTY", "MINUTES"]);
    expect(headlineLines("Summit")).toEqual(["SUMMIT", ""]);
  });
});

describe("episode file built from a Studio explainer", () => {
  const input = {
    id: "studio-abc",
    title: "Harbor ferry timetable",
    factsAsOf: "2026-11-17",
    lines: ["The ferry runs every twenty minutes.", "Tickets are sold at the pier."],
    cards: [
      card("New timetable", "Every twenty minutes", "From the north pier"),
      card("Tickets", "Sold at the pier", "Under fives free"),
    ],
    claimIds: ["c1"],
    assetsDir: "/engine/assets",
    soundBed: "/engine/assets/sound-bed.wav",
  };

  it("carries the operator's words onto the screen and dates the facts", () => {
    const ep = buildEpisode(input);
    expect(ep.beats.map((b) => b.id)).toEqual(["B01", "B02"]);
    expect(ep.beats[0]!.picture).toMatchObject({
      title: ["EVERY TWENTY", "MINUTES"],
      eyebrow: "NEW TIMETABLE",
      detail: "FROM THE NORTH PIER",
      graphic: { type: "lens" },
    });
    expect(ep.beats[1]!.picture.graphic).toEqual({ type: "network", label: "TICKETS" });
    expect(ep.beats[1]!.phrases.join(" ")).toBe("Tickets are sold at the pier.");
    expect(ep.labels.footer).toContain("FACTS AS OF NOV 17, 2026");
    expect(ep.labels.top_right).toContain("NOT GAMEPLAY");
    expect(ep.beats[0]!.claims).toEqual(["c1"]);
  });

  it("is the same for the same input and different for different content", () => {
    expect(buildEpisode(input)).toEqual(buildEpisode(input));
    const other = buildEpisode({
      ...input,
      lines: ["Four trails reopened this week.", "The summit path stays closed."],
    });
    expect(other.beats[0]!.phrases).not.toEqual(buildEpisode(input).beats[0]!.phrases);
  });

  it("refuses a script whose cards and lines do not pair up", () => {
    expect(() => buildEpisode({ ...input, cards: input.cards.slice(0, 1) })).toThrow(
      /one title card for every spoken line/,
    );
  });
});
