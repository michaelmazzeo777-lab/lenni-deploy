import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

// The capture ingest folder: the ONLY place the Studio reads operator-supplied
// media from (PS5 USB exports, narration recordings). Files are referenced by
// bare name; anything that could escape the folder is refused.

export const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".mkv", ".webm"];
export const AUDIO_EXT = [".wav", ".m4a", ".mp3", ".aiff"];

export function ingestDir(): string {
  return path.resolve(process.env.CAPTURE_INGEST_DIR ?? "./.data/ingest");
}

export async function resolveIngestFile(name: string, allowedExt: string[]): Promise<string> {
  if (!name || name !== path.basename(name) || name.startsWith(".")) {
    throw new Error("Invalid file name (must be a plain file name in the ingest folder)");
  }
  if (!allowedExt.includes(path.extname(name).toLowerCase())) {
    throw new Error(`Unsupported file type (allowed: ${allowedExt.join(", ")})`);
  }
  const full = path.join(ingestDir(), name);
  // lstat: a symlink is not a regular file, so links out of the folder are refused.
  const info = await lstat(full).catch(() => null);
  if (!info || !info.isFile()) throw new Error("File not found in the ingest folder");
  return full;
}

export async function listIngestFiles(allowedExt: string[]): Promise<string[]> {
  const names = await readdir(ingestDir()).catch(() => [] as string[]);
  return names
    .filter((n) => !n.startsWith(".") && allowedExt.includes(path.extname(n).toLowerCase()))
    .sort();
}
