// Adapted from the recovered v0.2 core.py helper_handoff: deterministic
// evidence retrieval, never model inference or gameplay verification.
export function questionTerms(question: string): string[] {
  return [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].slice(0, 12);
}

export const HELPER_BOUNDARY =
  "RESEARCH REQUIRED — local evidence leads, not a verified answer. No model or console is connected.";

export const HELPER_CHECKS = [
  "Record game, mode, platform, edition, build, region and spoiler ceiling.",
  "Open current official sources and check dates, contradictions and claim scope.",
  "Keep inference separate from official statements and trailer observations.",
  "OBSERVED_IN_GAME needs an accepted human-owned gameplay test, capture hash, method and limitations.",
  "Preserve the seven canonical claim states; unresolved evidence remains UNKNOWN or STALE_OR_CONTRADICTED.",
  "No publication, external sending or physical PS5 control is enabled.",
];
