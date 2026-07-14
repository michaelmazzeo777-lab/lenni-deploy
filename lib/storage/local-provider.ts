import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetStorage, StoredObjectMeta } from "@/lib/storage/types";

// Local-disk implementation of AssetStorage. Storage root defaults to a
// gitignored directory under the repository and can be overridden with
// STORAGE_ROOT for tests/CI. Never resolves outside the configured root.
export class LocalAssetStorage implements AssetStorage {
  readonly name = "local";
  private readonly root: string;

  constructor(root?: string) {
    this.root = path.resolve(root ?? process.env.STORAGE_ROOT ?? "./.data/storage");
  }

  private resolve(relativePath: string): string {
    const normalized = path.normalize(relativePath).replace(/^([/\\])+/, "");
    const full = path.resolve(this.root, normalized);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error("Path escapes storage root");
    }
    return full;
  }

  async write(relativePath: string, bytes: Buffer): Promise<StoredObjectMeta> {
    const full = this.resolve(relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return {
      storagePath: relativePath,
      sizeBytes: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolve(relativePath));
  }

  async move(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const from = this.resolve(fromRelativePath);
    const to = this.resolve(toRelativePath);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
  }

  async remove(relativePath: string): Promise<void> {
    const full = this.resolve(relativePath);
    await rm(full, { force: true });
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }
}

let singleton: LocalAssetStorage | null = null;
export function getAssetStorage(): LocalAssetStorage {
  if (!singleton) singleton = new LocalAssetStorage();
  return singleton;
}
