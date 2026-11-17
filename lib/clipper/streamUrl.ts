// Parses a public VOD URL into the platform, the video's stable id, and a
// canonical URL. Pure and offline: nothing here contacts a network. The
// canonical form is what gets stored as provenance and what yt-dlp is
// handed, so a shortened or tracking-laden URL never reaches either.
import { precondition } from "@/lib/errors";

export type StreamPlatform = "youtube" | "twitch" | "kick";

export interface ParsedStreamUrl {
  platform: StreamPlatform;
  /** Stable per-video id. For Kick this is the VOD uuid, not the channel. */
  videoId: string;
  canonicalUrl: string;
  /** Present when the URL itself names the channel (Twitch/Kick paths do). */
  channelHandle: string | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TWITCH_ID = /^\d+$/;
// Kick VOD ids are uuids; accept the canonical 8-4-4-4-12 hex form only.
const KICK_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function host(u: URL): string {
  return u.hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/^m\./, "");
}

/**
 * Throws a domain error rather than returning null: an unparseable URL is an
 * operator mistake worth naming, and every caller would otherwise have to
 * invent the same message.
 */
export function parseStreamUrl(raw: string): ParsedStreamUrl {
  const trimmed = raw.trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw precondition(`Not a URL: ${trimmed.slice(0, 120)}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw precondition(`Only http(s) URLs are supported, got ${u.protocol}`);
  }
  const h = host(u);
  const segments = u.pathname.split("/").filter(Boolean);

  if (h === "youtube.com" || h === "youtube-nocookie.com") {
    // /watch?v=ID, /live/ID, /shorts/ID, /embed/ID
    const fromQuery = u.searchParams.get("v");
    const fromPath =
      segments[0] === "live" || segments[0] === "shorts" || segments[0] === "embed"
        ? segments[1]
        : undefined;
    const id = fromQuery ?? fromPath;
    if (id && YOUTUBE_ID.test(id)) {
      return {
        platform: "youtube",
        videoId: id,
        canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
        channelHandle: null,
      };
    }
    throw precondition("YouTube URL carries no 11-character video id");
  }

  if (h === "youtu.be") {
    const id = segments[0];
    if (id && YOUTUBE_ID.test(id)) {
      return {
        platform: "youtube",
        videoId: id,
        canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
        channelHandle: null,
      };
    }
    throw precondition("youtu.be URL carries no 11-character video id");
  }

  if (h === "twitch.tv") {
    // /videos/123456789, or /<channel>/video/123456789
    const idx = segments.findIndex((s) => s === "videos" || s === "video");
    const id = idx >= 0 ? segments[idx + 1] : undefined;
    if (id && TWITCH_ID.test(id)) {
      return {
        platform: "twitch",
        videoId: id,
        canonicalUrl: `https://www.twitch.tv/videos/${id}`,
        channelHandle: idx > 0 ? segments[0]!.toLowerCase() : null,
      };
    }
    // A bare /<channel> URL is a live channel, not a VOD. Say so precisely:
    // the clipper works from a recorded VOD, never from a live edge.
    throw precondition("Twitch URL is not a VOD. Use a /videos/<id> link, not a live channel page");
  }

  if (h === "kick.com") {
    // /<channel>/videos/<uuid>
    const idx = segments.findIndex((s) => s === "videos" || s === "video");
    const id = idx >= 0 ? segments[idx + 1] : undefined;
    if (id && KICK_ID.test(id)) {
      return {
        platform: "kick",
        videoId: id.toLowerCase(),
        canonicalUrl: `https://kick.com/${segments[0]}/videos/${id.toLowerCase()}`,
        channelHandle: idx > 0 ? segments[0]!.toLowerCase() : null,
      };
    }
    throw precondition("Kick URL is not a VOD. Use a /<channel>/videos/<uuid> link");
  }

  throw precondition(`Unsupported platform: ${h}. Supported: YouTube, Twitch, Kick`);
}
