// Provider-neutral local file storage (docs/spec/03: "AssetStorage interface;
// local metadata/placeholder implementation for MVP; S3-compatible adapter
// later"). Only ever called server-side.

export interface StoredObjectMeta {
  storagePath: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface AssetStorage {
  readonly name: string;
  write(relativePath: string, bytes: Buffer): Promise<StoredObjectMeta>;
  read(relativePath: string): Promise<Buffer>;
  move(fromRelativePath: string, toRelativePath: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
}
