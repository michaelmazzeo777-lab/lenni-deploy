// Runs the vendored premium engine (Python) for one job, safely:
//   - no shell: the program and every argument are passed as an array;
//   - episode text travels in a JSON file, never on the command line;
//   - everything the engine writes stays inside the job's own work folder;
//   - the whole process group is killed on cancel or timeout.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PremiumEpisode } from "./episode";

export const ENGINE_DIR = path.resolve(process.cwd(), "premium-engine");
export const ENGINE_TIMEOUT_MS = Number(process.env.PREMIUM_TIMEOUT_MS ?? 20 * 60 * 1000);

const expand = (p: string) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);

/** Where the tools the engine needs live. Read at call time so tests can change them. */
export function engineTools() {
  const fonts =
    process.env.PREMIUM_FONT_DIR ??
    "~/pinokio/bin/miniforge/pkgs/font-ttf-ubuntu-0.83-h77eed37_3/fonts";
  return {
    python: expand(process.env.PREMIUM_PYTHON ?? "~/MESH/RUNTIME/build04-py/bin/python"),
    whisperCli: expand(process.env.WHISPER_CLI_PATH ?? "/opt/homebrew/bin/whisper-cli"),
    whisperModel: expand(process.env.WHISPER_MODEL_PATH ?? ""),
    fontRegular: expand(process.env.PREMIUM_FONT_REGULAR ?? `${fonts}/Ubuntu-R.ttf`),
    fontBold: expand(process.env.PREMIUM_FONT_BOLD ?? `${fonts}/Ubuntu-B.ttf`),
  };
}

/** Problems that would make every premium job fail; shown to the operator before starting. */
export function engineProblems(): string[] {
  const t = engineTools();
  const out: string[] = [];
  if (!existsSync(path.join(ENGINE_DIR, "drop_in_voice.py")))
    out.push("premium-engine folder is missing");
  if (!existsSync(t.python))
    out.push(`Python with Pillow not found at ${t.python} (set PREMIUM_PYTHON)`);
  if (!existsSync(t.fontRegular) || !existsSync(t.fontBold))
    out.push("engine font files not found (set PREMIUM_FONT_DIR)");
  return out;
}

/** A hash of the engine's code, so a changed engine makes a new job rather than reusing an old result. */
export function engineFingerprint(): string {
  const h = createHash("sha256");
  for (const f of [
    "drop_in_voice.py",
    "fgs/align.py",
    "fgs/audio.py",
    "fgs/qa.py",
    "fgs/render.py",
    "fgs/common.py",
  ]) {
    h.update(readFileSync(path.join(ENGINE_DIR, f)));
  }
  return h.digest("hex").slice(0, 16);
}

export function workRoot(): string {
  return path.resolve(process.env.PREMIUM_WORK_DIR ?? "./.data/premium-work");
}

export class EngineFailure extends Error {
  constructor(
    message: string,
    readonly kind: "refused" | "qa" | "crash" | "timeout" | "canceled",
    readonly log: string,
  ) {
    super(message);
  }
}

export interface EngineResult {
  runDir: string;
  masters: { "16:9": string; "9:16": string };
  acceptance: {
    overall: string;
    checks: { check: string; status: string; detail: string }[];
    files: Record<
      string,
      {
        sha256: string;
        bytes: number;
        duration: number;
        loudness: { integrated_lufs: number; true_peak_dbtp: number };
      }
    >;
  };
  cues: { beat: string; start: number; end: number; text: string; basis: string }[];
  srt: string;
  totalSec: number;
}

export async function runEngine(opts: {
  jobId: string;
  episode: PremiumEpisode;
  voicePath: string;
  voiceKind: "synthetic" | "human";
  voiceNote: string;
  lineTimes: [number, number][];
  onStart: (pid: number) => void | Promise<void>;
  onProgress: (text: string) => void;
  shouldCancel: () => Promise<boolean>;
}): Promise<EngineResult> {
  if (!/^[a-z0-9]+$/i.test(opts.jobId)) throw new Error("bad job id");
  const tools = engineTools();
  const problems = engineProblems();
  if (problems.length) throw new EngineFailure(problems.join("; "), "refused", "");
  const work = path.join(workRoot(), opts.jobId);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const template = JSON.parse(
    await readFile(path.join(ENGINE_DIR, "config/export.template.json"), "utf8"),
  );
  // Studio explainers are shorter than the engine's original 60-90 s episode.
  template.timing.min_total_sec = 12;
  template.timing.max_total_sec = 180;
  template.timing.min_beat_sec = 3.0;
  template.fonts = { regular: tools.fontRegular, bold: tools.fontBold };
  template.tools = {
    python_with_pillow: tools.python,
    whisper_cli: tools.whisperCli,
    whisper_model: tools.whisperModel || "/nonexistent",
  };
  await writeFile(path.join(work, "export.json"), JSON.stringify(template, null, 1));
  await writeFile(path.join(work, "episode.json"), JSON.stringify(opts.episode, null, 1));
  await writeFile(path.join(work, "line-times.json"), JSON.stringify(opts.lineTimes));

  const args = [
    path.join(ENGINE_DIR, "drop_in_voice.py"),
    "--voice",
    opts.voicePath,
    "--voice-kind",
    opts.voiceKind,
    "--voice-note",
    opts.voiceNote.slice(0, 300),
    "--episode",
    path.join(work, "episode.json"),
    "--export",
    path.join(work, "export.json"),
    "--runs-dir",
    path.join(work, "runs"),
    "--run-name",
    "job",
    "--line-times",
    path.join(work, "line-times.json"),
  ];
  const child = spawn("python3", args, {
    cwd: work,
    shell: false,
    detached: true, // its own process group, so the renderer's children die with it
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      HOME: os.homedir(),
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONUNBUFFERED: "1", // progress lines must arrive as they are printed
      LANG: "en_US.UTF-8",
    } as unknown as NodeJS.ProcessEnv,
  });
  await opts.onStart(child.pid!);
  let log = "";
  let stage = "Fitting captions to the narration";
  opts.onProgress(stage);
  const onLine = (line: string) => {
    if (line.startsWith("fit:")) stage = "Mixing and levelling sound";
    else if (line.startsWith("sound:")) stage = "Rendering picture";
    else if (line.startsWith("rendered:")) stage = "Checking the finished files";
    opts.onProgress(stage);
  };
  for (const s of [child.stdout!, child.stderr!]) {
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      log = (log + d).slice(-8000);
      d.split("\n").filter(Boolean).forEach(onLine);
    });
  }
  let ended: "timeout" | "canceled" | null = null;
  const kill = (why: "timeout" | "canceled") => {
    ended = why;
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      /* already gone */
    }
  };
  const timer = setTimeout(() => kill("timeout"), ENGINE_TIMEOUT_MS);
  const poll = setInterval(async () => {
    if (await opts.shouldCancel().catch(() => false)) return kill("canceled");
    if (stage !== "Rendering picture") return opts.onProgress(stage);
    // frame counts from the two renderer logs
    const pct: number[] = [];
    for (const tag of ["16x9", "9x16"]) {
      const f = path.join(work, "runs/job/checks", `render-${tag}.log`);
      const text = existsSync(f) ? readFileSync(f, "utf8") : "";
      const m = [...text.matchAll(/PROGRESS \w+ (\d+) \/ (\d+)/g)].pop();
      pct.push(
        text.includes("RENDERED") ? 100 : m ? Math.round((100 * Number(m[1])) / Number(m[2])) : 0,
      );
    }
    opts.onProgress(`Rendering picture: 16:9 ${pct[0]}%, 9:16 ${pct[1]}%`);
  }, 2000);
  const code: number | null = await new Promise((resolve) => {
    child.on("error", () => resolve(-1));
    child.on("close", (c) => resolve(c));
  });
  clearTimeout(timer);
  clearInterval(poll);
  if (ended === "canceled") throw new EngineFailure("Canceled by the operator", "canceled", log);
  if (ended === "timeout") {
    throw new EngineFailure(
      `The engine did not finish within ${Math.round(ENGINE_TIMEOUT_MS / 60000)} minutes and was stopped`,
      "timeout",
      log,
    );
  }
  const runDir = path.join(work, "runs/job");
  if (code === 2) {
    const m = /STOPPED: ([\s\S]*)$/.exec(log);
    const lengths = [...log.matchAll(/length problem: (.*)/g)].map((x) => x[1]);
    throw new EngineFailure(
      [...(lengths.length ? lengths : []), (m?.[1] ?? "The engine refused the input").trim()]
        .join(" — ")
        .slice(0, 1500),
      "refused",
      log,
    );
  }
  if (code !== 0 && code !== 1)
    throw new EngineFailure(`The engine stopped unexpectedly (exit ${code})`, "crash", log);
  const acceptance = JSON.parse(
    await readFile(path.join(runDir, "checks/acceptance.json"), "utf8"),
  ) as EngineResult["acceptance"];
  if (code === 1 || acceptance.overall !== "PASS") {
    const failed = acceptance.checks
      .filter((c) => c.status === "FAIL")
      .map((c) => `${c.check}: ${c.detail}`);
    throw new EngineFailure(
      `Premium render failed QA: ${failed.join("; ")}`.slice(0, 1500),
      "qa",
      log,
    );
  }
  const videos = (await readdir(path.join(runDir, "video"))).filter((f) => f.endsWith(".mp4"));
  const pick = (tag: string) => {
    const f = videos.find((v) => v.endsWith(`-${tag}.mp4`));
    if (!f) throw new EngineFailure(`The engine did not produce a ${tag} file`, "crash", log);
    return path.join(runDir, "video", f);
  };
  const timing = JSON.parse(await readFile(path.join(runDir, "timing.json"), "utf8")) as {
    total_sec: number;
  };
  return {
    runDir,
    masters: { "16:9": pick("16x9"), "9:16": pick("9x16") },
    acceptance,
    cues: JSON.parse(await readFile(path.join(runDir, "captions.timing.json"), "utf8")),
    srt: await readFile(path.join(runDir, "captions.srt"), "utf8"),
    totalSec: timing.total_sec,
  };
}

/** Removes a job's work folder (after its results are stored, or when it is abandoned). */
export async function cleanWork(jobId: string) {
  if (/^[a-z0-9]+$/i.test(jobId))
    await rm(path.join(workRoot(), jobId), { recursive: true, force: true });
}
