import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { makeWorkspace } from "../helpers/factory";
import { createContent } from "@/domain/content";
import { createAsset, rightsBlockers } from "@/domain/rights";
import { createVisualBrief, approveVisualPrompt, generateWithMock } from "@/domain/visuals";
import {
  uploadStoredFile,
  scanStoredFile,
  discardRejectedFile,
  MAX_UPLOAD_BYTES,
  SIMULATED_MALICIOUS_MARKER,
} from "@/domain/storage";
import { LocalAssetStorage } from "@/lib/storage/local-provider";

type A = Awaited<ReturnType<Awaited<ReturnType<typeof makeWorkspace>>["actor"]>>;
let owner: A, editor: A, rights: A, researcher: A;

// Minimal valid PNG signature bytes padded to look like a real (tiny) file.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeAll(async () => {
  const ws = await makeWorkspace();
  owner = await ws.actor([Role.OWNER], "owner");
  editor = await ws.actor([Role.EDITOR], "editor");
  rights = await ws.actor([Role.RIGHTS_REVIEWER], "rights");
  researcher = await ws.actor([Role.RESEARCHER], "res");
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function contentWithAsset() {
  const content = await createContent(editor, {
    type: "LONG_VIDEO",
    pillar: "BRIEFING",
    workingTitle: "Storage test content",
  });
  const asset = await createAsset(editor, {
    contentId: content.id,
    name: "Title card",
    mediaType: "image",
    ownership: "ORIGINAL",
  });
  return { content, asset };
}

describe("local file storage: upload + quarantine + scan", () => {
  it("uploads to quarantine as PENDING and blocks readiness until scanned", async () => {
    const { content, asset } = await contentWithAsset();

    const before = await rightsBlockers(content.id);
    expect(before.join(" ")).not.toMatch(/awaiting or failing content scan/);

    const stored = await uploadStoredFile(editor, {
      ownerType: "asset",
      ownerId: asset.id,
      filename: "card.png",
      mediaType: "image/png",
      data: PNG_BYTES,
    });
    expect(stored.quarantineStatus).toBe("PENDING");
    expect(stored.checksumSha256).toHaveLength(64);

    const blocked = await rightsBlockers(content.id);
    expect(blocked.join(" ")).toMatch(/awaiting or failing content scan/);

    // Asset location is not updated until the scan passes.
    const assetBefore = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(assetBefore?.location).toBeNull();

    const scanned = await scanStoredFile(rights, stored.id);
    expect(scanned.quarantineStatus).toBe("CLEAN");
    expect(scanned.scannedAt).toBeTruthy();

    const assetAfter = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(assetAfter?.location).toBe(scanned.storagePath);

    const cleared = await rightsBlockers(content.id);
    expect(cleared.join(" ")).not.toMatch(/awaiting or failing content scan/);

    // The bytes are actually retrievable from the clean path.
    const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
    const bytes = await storage.read(scanned.storagePath);
    expect(bytes.equals(PNG_BYTES)).toBe(true);
  });

  it("rejects a file matching the simulated-malware marker and blocks readiness", async () => {
    const { content, asset } = await contentWithAsset();
    const malicious = Buffer.concat([PNG_BYTES, Buffer.from(SIMULATED_MALICIOUS_MARKER)]);

    const stored = await uploadStoredFile(editor, {
      ownerType: "asset",
      ownerId: asset.id,
      filename: "card.png",
      mediaType: "image/png",
      data: malicious,
    });
    const scanned = await scanStoredFile(rights, stored.id);
    expect(scanned.quarantineStatus).toBe("REJECTED");
    expect(scanned.scanNotes).toMatch(/malware/i);

    expect((await rightsBlockers(content.id)).join(" ")).toMatch(
      /awaiting or failing content scan/,
    );

    const assetAfter = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(assetAfter?.location).toBeNull(); // never promoted

    await discardRejectedFile(editor, stored.id);
    const remaining = await prisma.storedFile.findUnique({ where: { id: stored.id } });
    expect(remaining).toBeNull();
    expect((await rightsBlockers(content.id)).join(" ")).not.toMatch(
      /awaiting or failing content scan/,
    );
  });

  it("rejects double-extension filenames as a scan failure", async () => {
    const { asset } = await contentWithAsset();
    const stored = await uploadStoredFile(editor, {
      ownerType: "asset",
      ownerId: asset.id,
      filename: "card.png.jpg",
      mediaType: "image/png",
      data: PNG_BYTES,
    });
    const scanned = await scanStoredFile(rights, stored.id);
    expect(scanned.quarantineStatus).toBe("REJECTED");
  });

  it("enforces size limit and allowed extensions before writing anything to disk", async () => {
    const { asset } = await contentWithAsset();
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    await expect(
      uploadStoredFile(editor, {
        ownerType: "asset",
        ownerId: asset.id,
        filename: "big.png",
        mediaType: "image/png",
        data: oversized,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await expect(
      uploadStoredFile(editor, {
        ownerType: "asset",
        ownerId: asset.id,
        filename: "script.exe",
        mediaType: "application/octet-stream",
        data: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    await expect(
      uploadStoredFile(editor, {
        ownerType: "asset",
        ownerId: asset.id,
        filename: "empty.png",
        mediaType: "image/png",
        data: Buffer.alloc(0),
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects a non-image payload renamed with an allowed extension (byte sniff)", async () => {
    const { asset } = await contentWithAsset();
    // Allowed extension + image/png media type, but the bytes are HTML, not a
    // real image. Must be refused before anything is written to disk.
    const fakeImage = Buffer.from("<html><script>alert(1)</script></html>", "utf8");
    await expect(
      uploadStoredFile(editor, {
        ownerType: "asset",
        ownerId: asset.id,
        filename: "payload.png",
        mediaType: "image/png",
        data: fakeImage,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Nothing was persisted for this asset.
    const count = await prisma.storedFile.count({ where: { assetId: asset.id } });
    expect(count).toBe(0);
  });

  it("re-uploading before scan replaces the pending file; cannot re-upload after scan", async () => {
    const { asset } = await contentWithAsset();
    const first = await uploadStoredFile(editor, {
      ownerType: "asset",
      ownerId: asset.id,
      filename: "a.png",
      mediaType: "image/png",
      data: PNG_BYTES,
    });
    const second = await uploadStoredFile(editor, {
      ownerType: "asset",
      ownerId: asset.id,
      filename: "b.png",
      mediaType: "image/png",
      data: PNG_BYTES,
    });
    expect(second.id).not.toBe(first.id);
    const stillOne = await prisma.storedFile.count({ where: { assetId: asset.id } });
    expect(stillOne).toBe(1);

    await scanStoredFile(rights, second.id);
    await expect(
      uploadStoredFile(editor, {
        ownerType: "asset",
        ownerId: asset.id,
        filename: "c.png",
        mediaType: "image/png",
        data: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("cannot scan the same file twice", async () => {
    const { asset } = await contentWithAsset();
    const stored = await uploadStoredFile(editor, {
      ownerType: "asset",
      ownerId: asset.id,
      filename: "x.png",
      mediaType: "image/png",
      data: PNG_BYTES,
    });
    await scanStoredFile(rights, stored.id);
    await expect(scanStoredFile(rights, stored.id)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("also supports VisualAsset ownership (dual-owner scheme)", async () => {
    const content = await createContent(editor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Visual storage test",
    });
    const brief = await createVisualBrief(editor, {
      contentId: content.id,
      kind: "DIAGRAM",
      title: "Diagram",
      prompt: "Original diagram.",
    });
    await approveVisualPrompt(owner, brief.id);
    const { asset: visualAsset } = await generateWithMock(editor, brief.id);

    const stored = await uploadStoredFile(editor, {
      ownerType: "visualAsset",
      ownerId: visualAsset.id,
      filename: "diagram.png",
      mediaType: "image/png",
      data: PNG_BYTES,
    });
    expect(stored.visualAssetId).toBe(visualAsset.id);
    const scanned = await scanStoredFile(rights, stored.id);
    expect(scanned.quarantineStatus).toBe("CLEAN");
    const va = await prisma.visualAsset.findUnique({ where: { id: visualAsset.id } });
    expect(va?.location).toBe(scanned.storagePath);
  });

  it("forbids roles without storage.upload / storage.scan", async () => {
    const { asset } = await contentWithAsset();
    await expect(
      uploadStoredFile(researcher, {
        ownerType: "asset",
        ownerId: asset.id,
        filename: "a.png",
        mediaType: "image/png",
        data: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stored = await uploadStoredFile(editor, {
      ownerType: "asset",
      ownerId: asset.id,
      filename: "a.png",
      mediaType: "image/png",
      data: PNG_BYTES,
    });
    await expect(scanStoredFile(researcher, stored.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(scanStoredFile(editor, stored.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("cannot upload against an asset in another workspace", async () => {
    const other = await makeWorkspace();
    const otherEditor = await other.actor([Role.EDITOR], "other-editor");
    const otherContent = await createContent(otherEditor, {
      type: "LONG_VIDEO",
      pillar: "BRIEFING",
      workingTitle: "Other workspace content",
    });
    const otherAsset = await createAsset(otherEditor, {
      contentId: otherContent.id,
      name: "Foreign asset",
      mediaType: "image",
    });
    await expect(
      uploadStoredFile(editor, {
        ownerType: "asset",
        ownerId: otherAsset.id,
        filename: "a.png",
        mediaType: "image/png",
        data: PNG_BYTES,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("LocalAssetStorage path safety", () => {
  it("refuses to write/read outside the configured storage root", async () => {
    const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
    await expect(storage.write("../../etc/evil", Buffer.from("x"))).rejects.toThrow(
      /escapes storage root/,
    );
    await expect(storage.read("../../../etc/passwd")).rejects.toThrow(/escapes storage root/);
  });

  it("round-trips a write/read/move/remove cycle", async () => {
    const storage = new LocalAssetStorage(process.env.STORAGE_ROOT);
    const meta = await storage.write("tmp/roundtrip.bin", Buffer.from("hello"));
    expect(meta.sizeBytes).toBe(5);
    const read = await storage.read("tmp/roundtrip.bin");
    expect(read.toString()).toBe("hello");
    await storage.move("tmp/roundtrip.bin", "tmp/moved.bin");
    const moved = await storage.read("tmp/moved.bin");
    expect(moved.toString()).toBe("hello");
    await storage.remove("tmp/moved.bin");
  });
});
