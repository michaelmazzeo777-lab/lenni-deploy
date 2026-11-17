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

// Second ingest root for the long-session clipper: a drop folder for raw PS5
// USB exports shared across worktrees, outside this repo. Read-and-copy only
// (see resolveInDir/lstat below) - nothing here ever writes back into it.
export function clipperIngestDir(): string {
  return path.resolve(
    process.env.CLIPPER_INGEST_DIR ?? path.join(process.cwd(), "..", "_inbox_footage"),
  );
}

async function resolveInDir(
  dir: string,
  name: string,
  allowedExt: string[],
): Promise<string | null> {
  if (!name || name !== path.basename(name) || name.startsWith(".")) {
    throw new Error("Invalid file name (must be a plain file name in the ingest folder)");
  }
  if (!allowedExt.includes(path.extname(name).toLowerCase())) {
    throw new Error(`Unsupported file type (allowed: ${allowedExt.join(", ")})`);
  }
  const full = path.join(dir, name);
  // lstat: a symlink is not a regular file, so links out of the folder are refused.
  const info = await lstat(full).catch(() => null);
  if (!info || !info.isFile()) return null;
  return full;
}

export async function resolveIngestFile(name: string, allowedExt: string[]): Promise<string> {
  const found = await resolveInDir(ingestDir(), name, allowedExt);
  if (!found) throw new Error("File not found in the ingest folder");
  return found;
}

/** Tries the capture ingest folder, then the clipper's shared drop folder. */
export async function resolveAnyIngestFile(name: string, allowedExt: string[]): Promise<string> {
  const found =
    (await resolveInDir(ingestDir(), name, allowedExt)) ??
    (await resolveInDir(clipperIngestDir(), name, allowedExt));
  if (!found) throw new Error("File not found in the ingest folder or the session drop folder");
  return found;
}

async function listDir(dir: string, allowedExt: string[]): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter(
    (n) => !n.startsWith(".") && allowedExt.includes(path.extname(n).toLowerCase()),
  );
}

export async function listIngestFiles(allowedExt: string[]): Promise<string[]> {
  return (await listDir(ingestDir(), allowedExt)).sort();
}

/** Files available from either ingest root, for the "clip a session" picker. */
export async function listAnyIngestFiles(allowedExt: string[]): Promise<string[]> {
  const names = new Set([
    ...(await listDir(ingestDir(), allowedExt)),
    ...(await listDir(clipperIngestDir(), allowedExt)),
  ]);
  return [...names].sort();
}
