// The clipping allowlist: channels whose owner has given permission for
// their VODs to be clipped. Deny by default - an empty or missing file
// refuses everything, which is the correct state until the owner names a
// channel. Nothing here verifies permission; it records a human decision.
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { precondition } from "@/lib/errors";
import type { StreamPlatform } from "@/lib/clipper/streamUrl";

export const AllowlistChannelSchema = z
  .object({
    platform: z.enum(["youtube", "twitch", "kick"]),
    /** Display name, for the on-screen credit and the post kit. */
    channelName: z.string().min(1),
    /** Stable handle/login where the platform has one (Twitch/Kick paths). */
    channelHandle: z.string().min(1).optional(),
    /** YouTube channel id (UC...), the only stable YouTube identifier. */
    channelId: z.string().min(1).optional(),
    /** Free text: who granted permission, when, and how. For the audit trail. */
    permissionNote: z.string().optional(),
  })
  .strict();

export const AllowlistSchema = z
  .object({
    comment: z.union([z.string(), z.array(z.string())]).optional(),
    version: z.literal(1),
    channels: z.array(AllowlistChannelSchema),
  })
  .strict();

export type AllowlistChannel = z.infer<typeof AllowlistChannelSchema>;
export type Allowlist = z.infer<typeof AllowlistSchema>;

export const EMPTY_ALLOWLIST: Allowlist = { version: 1, channels: [] };

export function allowlistPath(): string {
  return process.env.CLIPPER_ALLOWLIST_PATH ?? path.join(process.cwd(), "config", "allowlist.json");
}

/** A missing file is not an error: it means nothing is allowed yet. */
export function loadAllowlist(filePath = allowlistPath()): Allowlist {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return EMPTY_ALLOWLIST;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw precondition(
      `The allowlist at ${filePath} is not valid JSON: ${e instanceof Error ? e.message : "parse error"}`,
    );
  }
  const parsed = AllowlistSchema.safeParse(raw);
  if (!parsed.success) {
    throw precondition(
      `The allowlist at ${filePath} does not match the expected shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface MatchSubject {
  platform: StreamPlatform;
  /** From the URL path where present, else from yt-dlp metadata. */
  channelHandle?: string | null;
  /** yt-dlp's `channel_id` (YouTube UC...), when known. */
  channelId?: string | null;
  /** yt-dlp's `channel`/`uploader` display name, when known. */
  channelName?: string | null;
}

/**
 * Matches on the most stable identifier available, in order: platform channel
 * id, then handle, then display name. Display-name matching is last because a
 * streamer can change it, and a renamed channel matching an old entry would
 * silently clip someone who never agreed.
 */
export function matchAllowlist(
  subject: MatchSubject,
  list: Allowlist = loadAllowlist(),
): AllowlistChannel | null {
  const samePlatform = list.channels.filter((c) => c.platform === subject.platform);
  const byId =
    norm(subject.channelId) &&
    samePlatform.find((c) => c.channelId && norm(c.channelId) === norm(subject.channelId));
  if (byId) return byId;
  const byHandle =
    norm(subject.channelHandle) &&
    samePlatform.find(
      (c) => c.channelHandle && norm(c.channelHandle) === norm(subject.channelHandle),
    );
  if (byHandle) return byHandle;
  const byName =
    norm(subject.channelName) &&
    samePlatform.find((c) => norm(c.channelName) === norm(subject.channelName));
  if (byName) return byName;
  return null;
}

export interface AllowlistDecision {
  allowed: boolean;
  entry: AllowlistChannel | null;
  /** Set when an unlisted channel was allowed by explicit owner approval. */
  unlistedApprovedBy: string | null;
  reason: string;
}

/**
 * Deny by default. `allowUnlisted` alone is NOT enough: it must carry the
 * approving user's id, because the prompt's rule is that --allow-unlisted
 * needs the owner's approval for that specific run. A bare flag with no
 * approver is refused, so the flag can never become a habit that silently
 * bypasses the file.
 */
export function decideAllowlist(
  subject: MatchSubject,
  opts: { allowUnlisted?: boolean; approvedBy?: string | null } = {},
  list: Allowlist = loadAllowlist(),
): AllowlistDecision {
  const entry = matchAllowlist(subject, list);
  const who = subject.channelName || subject.channelHandle || subject.channelId || "(unknown)";
  if (entry) {
    return {
      allowed: true,
      entry,
      unlistedApprovedBy: null,
      reason: `${who} is on the clipping allowlist (${subject.platform})`,
    };
  }
  if (opts.allowUnlisted) {
    const approver = (opts.approvedBy ?? "").trim();
    if (!approver) {
      return {
        allowed: false,
        entry: null,
        unlistedApprovedBy: null,
        reason:
          `${who} is not on the allowlist. --allow-unlisted requires the owner's approval ` +
          `for this run; re-run with the approving user recorded.`,
      };
    }
    return {
      allowed: true,
      entry: null,
      unlistedApprovedBy: approver,
      reason: `${who} is not on the allowlist; allowed for this run by ${approver}`,
    };
  }
  return {
    allowed: false,
    entry: null,
    unlistedApprovedBy: null,
    reason:
      list.channels.length === 0
        ? `The allowlist is empty, so no channel can be clipped yet. Add ${who} to config/allowlist.json first.`
        : `${who} is not on the clipping allowlist for ${subject.platform}.`,
  };
}
