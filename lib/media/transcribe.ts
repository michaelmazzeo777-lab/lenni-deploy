import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ffmpeg, run } from "@/lib/media/ffmpeg";
import type { TimedWord } from "@/lib/media/align";

// Local speech-to-text through whisper.cpp's `whisper-cli`. Nothing leaves the
// machine. The model file is not part of the repository: WHISPER_MODEL_PATH
// must point at a ggml model. Without a model (or without the binary) the
// answer is NOT_VERIFIED - never a pass.

export type Transcription =
  | { status: "OK"; engine: string; model: string; text: string; words: TimedWord[] }
  | { status: "NOT_VERIFIED"; reason: string };

const DEFAULT_BIN = "/opt/homebrew/bin/whisper-cli";

export function transcriberConfig(): { bin: string; model: string } | { missing: string } {
  const model = process.env.WHISPER_MODEL_PATH?.trim();
  if (!model) return { missing: "WHISPER_MODEL_PATH is not set" };
  if (!existsSync(model)) return { missing: `speech model not found at ${model}` };
  const bin = process.env.WHISPER_CLI_PATH?.trim() || DEFAULT_BIN;
  if (!existsSync(bin)) return { missing: `whisper-cli not found at ${bin}` };
  return { bin, model };
}

/** Transcribes the audio of any media file, with a start/end time per word. */
export async function transcribe(mediaPath: string): Promise<Transcription> {
  const cfg = transcriberConfig();
  if ("missing" in cfg) return { status: "NOT_VERIFIED", reason: cfg.missing };
  const dir = await mkdtemp(path.join(tmpdir(), "stt-"));
  try {
    const wav = path.join(dir, "a.wav");
    await ffmpeg(["-i", mediaPath, "-vn", "-ar", "16000", "-ac", "1", wav]);
    // -ml 1 -sow: one word per segment, so each word carries its own time.
    await run(cfg.bin, [
      "-m",
      cfg.model,
      "-f",
      wav,
      "-l",
      "en",
      "-np",
      "-ml",
      "1",
      "-sow",
      "-oj",
      "-of",
      path.join(dir, "out"),
    ]);
    const json = JSON.parse(await readFile(path.join(dir, "out.json"), "utf8")) as {
      transcription?: { text: string; offsets: { from: number; to: number } }[];
    };
    const words: TimedWord[] = (json.transcription ?? [])
      .map((s) => ({
        text: s.text.trim(),
        startSec: s.offsets.from / 1000,
        endSec: s.offsets.to / 1000,
      }))
      // Bracketed tokens are whisper's non-speech markers ([BLANK_AUDIO], [MUSIC]).
      .filter((w) => w.text !== "" && !/^[[(].*[\])]$/.test(w.text));
    return {
      status: "OK",
      engine: "whisper.cpp",
      model: path.basename(cfg.model),
      text: words.map((w) => w.text).join(" "),
      words,
    };
  } catch (e) {
    return {
      status: "NOT_VERIFIED",
      reason: `transcription failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
