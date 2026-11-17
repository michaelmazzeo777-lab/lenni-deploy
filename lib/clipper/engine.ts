// Shared small pieces for the long-session clipper job: its own per-job work
// folder (mirrors lib/premium/engine.ts's workRoot()/cleanWork() exactly, in
// its own namespace so the two jobs never collide), and the readiness check
// run before a job is allowed to start.
import path from "node:path";
import { rm } from "node:fs/promises";
import { transcriberConfig } from "@/lib/media/transcribe";

export function clipperWorkRoot(): string {
  return path.resolve(process.env.CLIPPER_WORK_DIR ?? "./.data/clipper-work");
}

export async function cleanClipperWork(jobId: string): Promise<void> {
  await rm(path.join(clipperWorkRoot(), jobId), { recursive: true, force: true });
}

/**
 * Every gate checked before a clipper job is allowed to start. Word-level
 * timestamps are a hard requirement (A3: a clip boundary must never land
 * mid-word) - without a configured speech model this refuses rather than
 * silently shipping unsnapped boundaries.
 */
export function clipperProblems(): string[] {
  const cfg = transcriberConfig();
  if ("missing" in cfg) {
    return [`The clipper needs a speech model for word-accurate boundaries: ${cfg.missing}`];
  }
  return [];
}
