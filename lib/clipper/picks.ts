// The picks.json contract between the picking step and the clipping step.
//
// Picks arrive from a model reading the chunk files, so they are treated as
// untrusted input: strict schema, no unknown keys, every number bounded, and
// quotes never taken on faith. A malformed or over-long pick is refused with
// a named reason rather than clamped silently, because a silently-moved
// boundary is how a clip ends up cutting mid-sentence.
import { z } from "zod";
import { precondition } from "@/lib/errors";
import { CLIP_MAX_SEC, CLIP_MIN_SEC } from "@/lib/clipper/moments";

export const PICK_CATEGORIES = [
  "reaction",
  "skill",
  "fail",
  "funny",
  "story",
  "discovery",
  "banter",
] as const;

export const PickSchema = z
  .object({
    /** Absolute stream seconds, as printed in the chunk files. */
    start: z.number().finite().min(0),
    end: z.number().finite().min(0),
    category: z.enum(PICK_CATEGORIES),
    /** Shown over the first seconds of the clip. Short enough to read. */
    hook_title: z.string().trim().min(3).max(80),
    why: z.string().trim().min(10).max(500),
    /** Does it stand alone with no prior context? The harsh test. */
    standalone: z.boolean(),
    energy: z.number().int().min(1).max(10),
    shareability: z.number().int().min(1).max(10),
    total: z.number().int().min(1).max(20),
  })
  .strict();

export type Pick = z.infer<typeof PickSchema>;

export const PicksFileSchema = z
  .object({
    runId: z.string().min(1),
    rubricVersion: z.number().int().min(1),
    picks: z.array(PickSchema).min(1).max(50),
  })
  .strict();

export type PicksFile = z.infer<typeof PicksFileSchema>;

function issueText(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/**
 * Validates the raw parsed JSON. Beyond the schema it enforces the things a
 * schema cannot express: end after start, a storable length, and a total
 * that matches its parts (a mismatched total means the model was not
 * actually scoring, so the ranking cannot be trusted).
 */
export function parsePicks(raw: unknown): PicksFile {
  const parsed = PicksFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw precondition(`picks.json does not match the required shape: ${issueText(parsed.error)}`);
  }
  const file = parsed.data;
  const problems: string[] = [];
  file.picks.forEach((p, i) => {
    const at = `pick[${i}] (${p.start}-${p.end})`;
    if (!(p.end > p.start)) problems.push(`${at}: end must be after start`);
    const len = p.end - p.start;
    if (len < CLIP_MIN_SEC) {
      problems.push(`${at}: ${len.toFixed(1)}s is under the ${CLIP_MIN_SEC}s minimum`);
    }
    if (len > CLIP_MAX_SEC) {
      problems.push(`${at}: ${len.toFixed(1)}s is over the ${CLIP_MAX_SEC}s maximum`);
    }
    if (p.total !== p.energy + p.shareability) {
      problems.push(
        `${at}: total ${p.total} does not equal energy ${p.energy} + shareability ${p.shareability}`,
      );
    }
  });
  if (problems.length) throw precondition(`picks.json is invalid: ${problems.join("; ")}`);
  return file;
}

/** Parses a picks.json file's text. Separated so tests need no filesystem. */
export function parsePicksText(text: string): PicksFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw precondition(
      `picks.json is not valid JSON: ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
  return parsePicks(raw);
}

export interface SelectedPick extends Pick {
  rank: number;
}

/**
 * Orders by score and drops picks that fail the standalone test or overlap a
 * better-scoring one, then takes the top `n`. Overlap is rejected rather
 * than merged: two picks over the same seconds are a disagreement about
 * where the moment is, and merging would invent a third answer.
 */
export function selectPicks(file: PicksFile, n: number): SelectedPick[] {
  const ordered = [...file.picks]
    .filter((p) => p.standalone)
    .sort((a, b) => b.total - a.total || a.start - b.start);
  const kept: SelectedPick[] = [];
  for (const p of ordered) {
    if (kept.length >= n) break;
    if (kept.some((k) => p.start < k.end && k.start < p.end)) continue;
    kept.push({ ...p, rank: kept.length + 1 });
  }
  return kept;
}
