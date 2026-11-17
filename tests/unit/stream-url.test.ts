import { describe, it, expect } from "vitest";
import { parseStreamUrl } from "@/lib/clipper/streamUrl";

describe("parseStreamUrl", () => {
  it("reads a standard YouTube watch URL", () => {
    const r = parseStreamUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r.platform).toBe("youtube");
    expect(r.videoId).toBe("dQw4w9WgXcQ");
    expect(r.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("canonicalises youtu.be, /live/, and tracking params to one form", () => {
    const expected = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    for (const raw of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc123",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(parseStreamUrl(raw).canonicalUrl, raw).toBe(expected);
    }
  });

  it("reads a Twitch VOD, with and without the channel in the path", () => {
    expect(parseStreamUrl("https://www.twitch.tv/videos/1234567890")).toMatchObject({
      platform: "twitch",
      videoId: "1234567890",
      channelHandle: null,
    });
    expect(parseStreamUrl("https://twitch.tv/SomeStreamer/video/1234567890")).toMatchObject({
      platform: "twitch",
      videoId: "1234567890",
      channelHandle: "somestreamer",
    });
  });

  it("reads a Kick VOD and keeps the channel handle", () => {
    const r = parseStreamUrl(
      "https://kick.com/SomeStreamer/videos/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    );
    expect(r).toMatchObject({
      platform: "kick",
      videoId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      channelHandle: "somestreamer",
    });
  });

  it("refuses a live channel page rather than treating it as a VOD", () => {
    expect(() => parseStreamUrl("https://www.twitch.tv/somestreamer")).toThrow(/not a VOD/i);
  });

  it("refuses an unsupported platform by name", () => {
    expect(() => parseStreamUrl("https://vimeo.com/123456")).toThrow(/Unsupported platform/i);
  });

  it("refuses a malformed id instead of passing it to yt-dlp", () => {
    expect(() => parseStreamUrl("https://www.youtube.com/watch?v=tooshort")).toThrow(
      /11-character/,
    );
    expect(() => parseStreamUrl("https://www.twitch.tv/videos/not-a-number")).toThrow(/not a VOD/i);
    expect(() => parseStreamUrl("https://kick.com/x/videos/not-a-uuid")).toThrow(/not a VOD/i);
  });

  it("refuses non-URLs and non-http schemes", () => {
    expect(() => parseStreamUrl("not a url at all")).toThrow(/Not a URL/i);
    expect(() => parseStreamUrl("file:///etc/passwd")).toThrow(/http/i);
  });
});
