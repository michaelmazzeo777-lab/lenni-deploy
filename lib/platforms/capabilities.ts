// Platform Connection Center: what each platform allows, what this Studio
// actually does, and what stays manual. Facts come from the official pages
// listed per entry, read on VERIFIED_ON; anything not confirmed there is
// marked unverified. Nothing here connects an account: there is no OAuth flow,
// no token storage and no upload code in this build.

export const VERIFIED_ON = "2026-11-17";

export type Outcome =
  | "IMPLEMENTED_LOCAL" // works in this Studio, tested locally, no external account involved
  | "GUIDED_SETUP" // the platform offers it; steps to set it up are given, nothing is connected
  | "NOT_SUPPORTED"; // unavailable, not permitted, or deliberately disabled here

export type Fn =
  | "discovery"
  | "accountMetadata"
  | "footageAccess"
  | "connection"
  | "upload"
  | "draftPrivate"
  | "scheduling"
  | "publication"
  | "analytics"
  | "disconnect";

export const FUNCTIONS: { key: Fn; label: string }[] = [
  { key: "discovery", label: "Creator / profile discovery" },
  { key: "accountMetadata", label: "Authorized account metadata" },
  { key: "footageAccess", label: "Source footage access" },
  { key: "connection", label: "Account connection" },
  { key: "upload", label: "Upload / submission" },
  { key: "draftPrivate", label: "Draft / private handling" },
  { key: "scheduling", label: "Scheduling" },
  { key: "publication", label: "Publication" },
  { key: "analytics", label: "Analytics" },
  { key: "disconnect", label: "Disconnect / revoke" },
];

export interface Capability {
  outcome: Outcome;
  note: string;
  unverified?: boolean; // true when the official page read did not confirm the claim
}

export interface Platform {
  key: "youtube" | "twitch" | "instagram" | "facebook" | "tiktok";
  name: string;
  /** Where Mike publishes by hand today. Opening it does nothing on its own. */
  manualDestination: string;
  sources: { label: string; url: string }[];
  setupSteps: string[];
  capabilities: Record<Fn, Capability>;
}

// Shared rows that are the same for every platform in this build.
const local = {
  discovery: {
    outcome: "IMPLEMENTED_LOCAL",
    note: "Record publicly researched creators by hand in Creators & rights, with source and date. No automated scraping.",
  },
  footageAccess: {
    outcome: "NOT_SUPPORTED",
    note: "Public videos are never downloaded for reuse. Footage comes from Mike's own captures or from a creator under an active agreement, ingested from a file.",
  },
  publication: {
    outcome: "NOT_SUPPORTED",
    note: "Disabled in this build. Publishing needs Mike's separate approval and all three clearance layers; today it is done by hand on the platform.",
  },
  disconnect: {
    outcome: "NOT_SUPPORTED",
    note: "Nothing is connected, so there is nothing to disconnect. Any future connection must include revocation.",
  },
} satisfies Partial<Record<Fn, Capability>>;

const noConnection: Capability = {
  outcome: "GUIDED_SETUP",
  note: "Not connected. Follow the setup steps; the Studio stores no credentials or tokens.",
};

export const PLATFORMS: Platform[] = [
  {
    key: "youtube",
    name: "YouTube",
    manualDestination: "https://studio.youtube.com/",
    sources: [
      {
        label: "YouTube Data API: videos.insert",
        url: "https://developers.google.com/youtube/v3/docs/videos/insert",
      },
      {
        label: "YouTube API Services developer policies",
        url: "https://developers.google.com/youtube/terms/developer-policies",
      },
      {
        label: "YouTube Partner Program",
        url: "https://support.google.com/youtube/answer/1311392",
      },
    ],
    setupSteps: [
      "Create a Google Cloud project owned by the channel owner and enable the YouTube Data API v3.",
      "Configure the OAuth consent screen and request only the youtube.upload scope.",
      "Read and accept the YouTube API Services developer policies; plan for the upload quota (the videos.insert page lists 100 upload calls per day).",
      "Ask for Mike's written approval before any code that uploads is built or any account is connected.",
    ],
    capabilities: {
      ...local,
      accountMetadata: noConnection,
      connection: noConnection,
      upload: {
        outcome: "GUIDED_SETUP",
        note: "videos.insert accepts uploads with the youtube.upload scope (or broader). Not built here.",
      },
      draftPrivate: {
        outcome: "GUIDED_SETUP",
        note: "Uploads can be private, unlisted or public; some may default to private by account settings (videos.insert page).",
      },
      scheduling: {
        outcome: "GUIDED_SETUP",
        note: "Scheduled release is available in YouTube Studio; API scheduling was not confirmed on the page read.",
        unverified: true,
      },
      analytics: {
        outcome: "IMPLEMENTED_LOCAL",
        note: "Manual analytics import exists in the Studio (Analytics page). The YouTube Analytics API is not connected.",
      },
    },
  },
  {
    key: "twitch",
    name: "Twitch",
    manualDestination: "https://dashboard.twitch.tv/",
    sources: [
      { label: "Twitch API overview", url: "https://dev.twitch.tv/docs/api/" },
      { label: "Twitch clips guide", url: "https://dev.twitch.tv/docs/api/clips" },
    ],
    setupSteps: [
      "Register an application in the Twitch developer console.",
      "Clips can only be created from a live broadcast (clips:edit scope); they are not a licence to reuse anyone's footage.",
      "Get a creator's permission in writing (Creators & rights) before using any of their stream.",
    ],
    capabilities: {
      ...local,
      accountMetadata: noConnection,
      connection: noConnection,
      upload: {
        outcome: "NOT_SUPPORTED",
        note: "The clips guide documents no video upload API.",
        unverified: true,
      },
      draftPrivate: { outcome: "NOT_SUPPORTED", note: "No upload path, so no draft handling." },
      scheduling: { outcome: "NOT_SUPPORTED", note: "No upload path, so no scheduling." },
      analytics: {
        outcome: "GUIDED_SETUP",
        note: "Not researched for this build; check the Twitch API overview.",
        unverified: true,
      },
    },
  },
  {
    key: "instagram",
    name: "Instagram",
    manualDestination: "https://www.instagram.com/",
    sources: [
      {
        label: "Instagram Platform: content publishing",
        url: "https://developers.facebook.com/docs/instagram-platform/content-publishing/",
      },
    ],
    setupSteps: [
      "Use an Instagram professional account.",
      "Create a Meta app; content publishing needs instagram_content_publish (or instagram_business_content_publish with Instagram Login) and Advanced or Standard Access.",
      "Respect the publishing limit on the content publishing page (100 API-published posts per 24 hours).",
    ],
    capabilities: {
      ...local,
      accountMetadata: noConnection,
      connection: noConnection,
      upload: {
        outcome: "GUIDED_SETUP",
        note: "Reels can be published to professional accounts through a media container (media_type=REELS).",
      },
      draftPrivate: {
        outcome: "NOT_SUPPORTED",
        note: "No draft state documented; unpublished containers expire after 24 hours.",
      },
      scheduling: {
        outcome: "NOT_SUPPORTED",
        note: "No native scheduling parameter; an app would have to hold and publish later itself.",
      },
      analytics: {
        outcome: "GUIDED_SETUP",
        note: "Not researched for this build.",
        unverified: true,
      },
    },
  },
  {
    key: "facebook",
    name: "Facebook",
    manualDestination: "https://business.facebook.com/",
    sources: [
      {
        label: "Facebook Reels publishing",
        url: "https://developers.facebook.com/docs/video-api/guides/reels-publishing",
      },
      { label: "Meta for Developers", url: "https://developers.facebook.com/docs/" },
    ],
    setupSteps: [
      "Reels can only be published to Facebook Pages, not personal profiles.",
      "A Meta app needs pages_show_list, pages_read_engagement and pages_manage_posts from someone who can create content on the Page.",
      "Show users the required disclosure; the documented limit is 30 API-published posts per 24 hours.",
    ],
    capabilities: {
      ...local,
      accountMetadata: noConnection,
      connection: noConnection,
      upload: { outcome: "GUIDED_SETUP", note: "Page Reels upload is documented. Not built here." },
      draftPrivate: {
        outcome: "GUIDED_SETUP",
        note: "Reels can be saved as drafts (Reels publishing guide).",
      },
      scheduling: {
        outcome: "GUIDED_SETUP",
        note: "Scheduling is documented: 10 minutes to 29 days ahead.",
      },
      analytics: {
        outcome: "GUIDED_SETUP",
        note: "Not researched for this build.",
        unverified: true,
      },
    },
  },
  {
    key: "tiktok",
    name: "TikTok",
    manualDestination: "https://www.tiktok.com/upload",
    sources: [
      {
        label: "TikTok Content Posting API: get started",
        url: "https://developers.tiktok.com/doc/content-posting-api-get-started",
      },
      { label: "TikTok for Developers", url: "https://developers.tiktok.com/" },
    ],
    setupSteps: [
      "Register an app, add the Content Posting API product and request the video.publish scope.",
      "Until the app passes TikTok's audit, everything it posts is restricted to private viewing.",
      "Ask for Mike's written approval before any posting code is built.",
    ],
    capabilities: {
      ...local,
      accountMetadata: noConnection,
      connection: noConnection,
      upload: {
        outcome: "GUIDED_SETUP",
        note: "Direct posting needs video.publish and app approval; unaudited apps post privately only.",
      },
      draftPrivate: {
        outcome: "GUIDED_SETUP",
        note: "Unaudited clients are limited to private viewing; an inbox/draft flow was not confirmed on the page read.",
        unverified: true,
      },
      scheduling: {
        outcome: "NOT_SUPPORTED",
        note: "No scheduling documented on the page read.",
        unverified: true,
      },
      analytics: {
        outcome: "GUIDED_SETUP",
        note: "Not researched for this build.",
        unverified: true,
      },
    },
  },
];

/** Hosts allowed in links on this screen: only the platforms' own sites. */
export const OFFICIAL_HOSTS = [
  "developers.google.com",
  "support.google.com",
  "studio.youtube.com",
  "dev.twitch.tv",
  "dashboard.twitch.tv",
  "developers.facebook.com",
  "business.facebook.com",
  "www.instagram.com",
  "developers.tiktok.com",
  "www.tiktok.com",
];
