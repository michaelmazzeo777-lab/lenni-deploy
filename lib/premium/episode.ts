// Turns a Studio explainer (spoken lines + title cards) into the episode file
// the premium engine reads. Pure: same input, same episode. The operator never
// sees or edits this file.
import type { CardSpec } from "@/lib/media/cards";

export const PREMIUM_ENGINE_VERSION = "premium-1";

/** Longest caption the engine shows on two lines in both formats. */
export const MAX_PHRASE_CHARS = 46;
const MIN_PHRASE_CHARS = 12;

const ACCENTS: [number, number, number][] = [
  [74, 220, 216],
  [255, 197, 112],
  [233, 142, 169],
  [84, 213, 214],
  [255, 172, 96],
  [128, 227, 210],
  [255, 202, 123],
  [104, 233, 215],
];
// Pairs of background images from premium-engine/assets (rights OPEN; see PROVENANCE.md).
const ART: [string, string][] = [
  ["generated-env-1-1.jpg", "generated-env-3-3.jpg"],
  ["generated-env-2-2.jpg", "generated-env-1-1.jpg"],
  ["generated-env-3-2.jpg", "generated-env-2-2.jpg"],
  ["generated-env-3-3.jpg", "generated-env-2-1.jpg"],
  ["generated-env-2-3.jpg", "generated-env-1-3.jpg"],
  ["generated-env-3-1.jpg", "generated-env-1-1.jpg"],
  ["generated-env-1-1.jpg", "generated-env-2-3.jpg"],
  ["generated-env-1-2.jpg", "generated-env-3-3.jpg"],
];
export const PREMIUM_ART_FILES = [...new Set(ART.flat())].sort();

/** Splits at the space nearest the middle. */
function halve(text: string): [string, string] {
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? [text, ""] : [text.slice(0, best), text.slice(best + 1)];
}

/**
 * Caption phrases for one spoken line: break after punctuation, split pieces
 * that are too long for a caption, and join pieces too short to stand alone.
 * Joined with single spaces the phrases are exactly the line.
 */
export function splitPhrases(line: string): string[] {
  const text = line.trim().replace(/\s+/g, " ");
  let parts = text.match(/[^,.;:!?]+[,.;:!?]+["”']?\s*|[^,.;:!?]+$/g)?.map((p) => p.trim()) ?? [
    text,
  ];
  parts = parts.filter(Boolean);
  // join short pieces to a neighbour while the result still fits
  const joined: string[] = [];
  for (const p of parts) {
    const last = joined[joined.length - 1];
    if (
      last !== undefined &&
      (p.length < MIN_PHRASE_CHARS || last.length < MIN_PHRASE_CHARS) &&
      last.length + 1 + p.length <= MAX_PHRASE_CHARS
    ) {
      joined[joined.length - 1] = `${last} ${p}`;
    } else joined.push(p);
  }
  // split pieces that are too long
  const out: string[] = [];
  const split = (p: string) => {
    if (p.length <= MAX_PHRASE_CHARS || !p.includes(" ")) return void out.push(p);
    const [a, b] = halve(p);
    split(a);
    split(b);
  };
  joined.forEach(split);
  return out;
}

/** A card's statement as the two headline lines the engine draws. */
export function headlineLines(value: string): [string, string] {
  const v = value.trim().replace(/\s+/g, " ").toUpperCase();
  return v.length <= 14 ? [v, ""] : halve(v);
}

export interface EpisodeInput {
  id: string;
  title: string;
  factsAsOf: string; // YYYY-MM-DD
  lines: string[];
  cards: CardSpec[];
  claimIds: string[];
  assetsDir: string;
  soundBed: string | null;
}

export function buildEpisode(input: EpisodeInput) {
  if (input.lines.length === 0 || input.lines.length !== input.cards.length) {
    throw new Error("An explainer needs one title card for every spoken line");
  }
  const asOf = new Date(`${input.factsAsOf}T00:00:00Z`)
    .toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
    .toUpperCase();
  return {
    id: input.id,
    title: input.title,
    facts_as_of: input.factsAsOf,
    assets_dir: input.assetsDir,
    sound_bed: input.soundBed,
    labels: {
      brand: "LEONIDA  /  FIELD NOTES",
      top_right: "ORIGINAL ART · NOT GAMEPLAY · {voice_label}",
      footer: `INDEPENDENT FAN GUIDE  •  INTERNAL DRAFT  •  FACTS AS OF ${asOf}`,
    },
    pronunciation: {},
    beats: input.lines.map((line, i) => {
      const card = input.cards[i]!;
      return {
        id: `B${String(i + 1).padStart(2, "0")}`,
        claims: input.claimIds,
        phrases: splitPhrases(line),
        picture: {
          title: headlineLines(card.value),
          eyebrow: card.label.trim().toUpperCase(),
          detail: card.note.trim().toUpperCase(),
          accent: ACCENTS[i % ACCENTS.length]!,
          art: ART[i % ART.length]!,
          graphic:
            i % 2 === 0
              ? { type: "lens" }
              : { type: "network", label: card.label.trim().toUpperCase() },
        },
      };
    }),
  };
}
export type PremiumEpisode = ReturnType<typeof buildEpisode>;
