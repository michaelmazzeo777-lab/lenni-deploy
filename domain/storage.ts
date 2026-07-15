import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { notFound, precondition, forbidden } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { getAssetStorage } from "@/lib/storage/local-provider";
import { QuarantineStatus } from "@prisma/client";

// Local file storage, quarantine-first. New uploads never take effect until a
// scan promotes them to CLEAN — the owning Asset/VisualAsset "location" is
// only updated at that point (docs/spec/03 AssetStorage; threat model:
// malicious file content, path traversal).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB
const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

// Deterministic mock-malware fixture so tests can exercise a real rejection
// path without a real virus. Never a real threat signature.
export const SIMULATED_MALICIOUS_MARKER = "FIELD-GUIDE-STUDIO-TEST-MALWARE-MARKER";

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

// Content-sniffing: confirm the leading bytes actually match one of the
// allowed raster image formats, so a non-image payload (HTML/SVG/script)
// renamed to ".png" is rejected before it ever touches disk. This checks the
// bytes are *an* allowed image, not that they match the specific extension —
// a mismatched-but-valid double extension (card.png.jpg) is still caught by
// the scan gate, and honouring the byte content here is the real defence.
function looksLikeAllowedImage(bytes: Buffer): boolean {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return true;
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  // GIF: "GIF87a" / "GIF89a"
  if (bytes.length >= 6 && bytes.subarray(0, 3).toString("latin1") === "GIF") {
    return true;
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return true;
  }
  return false;
}

interface UploadInput {
  ownerType: "asset" | "visualAsset";
  ownerId: string;
  filename: string;
  mediaType: string;
  data: Buffer;
}

async function loadOwnerWorkspace(
  ownerType: "asset" | "visualAsset",
  ownerId: string,
): Promise<{ workspaceId: string } | null> {
  if (ownerType === "asset") {
    const asset = await prisma.asset.findUnique({
      where: { id: ownerId },
      include: { content: true },
    });
    return asset ? { workspaceId: asset.content.workspaceId } : null;
  }
  const visualAsset = await prisma.visualAsset.findUnique({
    where: { id: ownerId },
    include: { brief: { include: { content: true } } },
  });
  return visualAsset ? { workspaceId: visualAsset.brief.content.workspaceId } : null;
}

// Uploads a file into quarantine. Rejects unsupported extensions and
// oversized files before ever touching disk. Re-uploading before a scan
// replaces the previous quarantined bytes.
export async function uploadStoredFile(actor: Actor, input: UploadInput) {
  require_(actor, "storage.upload");

  const owner = await loadOwnerWorkspace(input.ownerType, input.ownerId);
  if (!owner || owner.workspaceId !== actor.workspaceId) {
    throw notFound(`${input.ownerType === "asset" ? "Asset" : "Visual asset"} not found`);
  }

  if (input.data.byteLength === 0) {
    throw precondition("Uploaded file is empty");
  }
  if (input.data.byteLength > MAX_UPLOAD_BYTES) {
    throw precondition(`File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MiB upload limit`);
  }
  const ext = extensionOf(input.filename);
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    throw precondition(
      `File type ".${ext || "?"}" is not allowed (allowed: ${[...ALLOWED_IMAGE_EXTENSIONS].join(", ")})`,
    );
  }
  if (!looksLikeAllowedImage(input.data)) {
    throw precondition("File content is not a recognised image (png, jpg, webp, or gif)");
  }

  const storage = getAssetStorage();
  const checksum = createHash("sha256").update(input.data).digest("hex");
  const quarantinePath = `quarantine/${input.ownerType}/${input.ownerId}/${checksum}-${input.filename}`;

  return prisma.$transaction(async (tx) => {
    const existing =
      input.ownerType === "asset"
        ? await tx.storedFile.findUnique({ where: { assetId: input.ownerId } })
        : await tx.storedFile.findUnique({ where: { visualAssetId: input.ownerId } });

    if (existing && existing.quarantineStatus !== "PENDING") {
      throw precondition(
        "A scanned file is already attached; remove it before uploading a replacement",
      );
    }
    if (existing) {
      // Removal failure is non-fatal (the record is gone either way) but must
      // be visible — a silent failure leaks orphaned quarantine bytes on disk.
      await storage.remove(existing.storagePath).catch((err: unknown) => {
        console.warn(
          `storage: failed to remove replaced quarantine file ${existing.storagePath}:`,
          err,
        );
      });
      await tx.storedFile.delete({ where: { id: existing.id } });
    }

    const meta = await storage.write(quarantinePath, input.data);

    const stored = await tx.storedFile.create({
      data: {
        workspaceId: actor.workspaceId,
        assetId: input.ownerType === "asset" ? input.ownerId : undefined,
        visualAssetId: input.ownerType === "visualAsset" ? input.ownerId : undefined,
        originalName: input.filename,
        mediaType: input.mediaType,
        sizeBytes: meta.sizeBytes,
        checksumSha256: meta.checksumSha256,
        storagePath: meta.storagePath,
        quarantineStatus: QuarantineStatus.PENDING,
        uploadedBy: actor.userId,
      },
    });

    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: existing ? "storage.reuploaded" : "storage.uploaded",
        entityType: input.ownerType === "asset" ? "Asset" : "VisualAsset",
        entityId: input.ownerId,
        metadata: {
          storedFileId: stored.id,
          sizeBytes: stored.sizeBytes,
          checksum: stored.checksumSha256,
        },
      },
      tx,
    );

    return stored;
  });
}

// Deterministic MOCK content gate — not a real antivirus engine (the UI says
// so too). A real implementation would call an external scanner; this one
// applies transparent, testable rules so the quarantine gate is genuinely
// enforced rather than a no-op.
function mockContentGate(bytes: Buffer, originalName: string): { clean: boolean; notes: string } {
  if (bytes.includes(Buffer.from(SIMULATED_MALICIOUS_MARKER))) {
    return { clean: false, notes: "Matched simulated-malware test marker" };
  }
  const parts = originalName.split(".");
  if (parts.length > 2) {
    return { clean: false, notes: "Double file extension is not allowed" };
  }
  return { clean: true, notes: "Passed mock scan (deterministic check — not a real AV engine)" };
}

export async function scanStoredFile(actor: Actor, storedFileId: string) {
  require_(actor, "storage.scan");
  const storage = getAssetStorage();

  const stored = await prisma.storedFile.findUnique({ where: { id: storedFileId } });
  if (!stored || stored.workspaceId !== actor.workspaceId) throw notFound("Stored file not found");
  if (stored.quarantineStatus !== "PENDING") {
    throw precondition("This file has already been scanned");
  }

  const bytes = await storage.read(stored.storagePath);
  const result = mockContentGate(bytes, stored.originalName);

  return prisma.$transaction(async (tx) => {
    if (result.clean) {
      const cleanPath = `clean/${stored.assetId ? "asset" : "visualAsset"}/${
        stored.assetId ?? stored.visualAssetId
      }/${stored.originalName}`;
      await storage.move(stored.storagePath, cleanPath);

      const updated = await tx.storedFile.update({
        where: { id: storedFileId },
        data: {
          quarantineStatus: QuarantineStatus.CLEAN,
          scanNotes: result.notes,
          scannedAt: new Date(),
          storagePath: cleanPath,
        },
      });
      if (stored.assetId) {
        await tx.asset.update({ where: { id: stored.assetId }, data: { location: cleanPath } });
      } else if (stored.visualAssetId) {
        await tx.visualAsset.update({
          where: { id: stored.visualAssetId },
          data: { location: cleanPath },
        });
      }
      await writeAudit(
        {
          workspaceId: actor.workspaceId,
          actorId: actor.userId,
          action: "storage.scan_passed",
          entityType: stored.assetId ? "Asset" : "VisualAsset",
          entityId: (stored.assetId ?? stored.visualAssetId)!,
          metadata: { storedFileId },
        },
        tx,
      );
      return updated;
    }

    const updated = await tx.storedFile.update({
      where: { id: storedFileId },
      data: {
        quarantineStatus: QuarantineStatus.REJECTED,
        scanNotes: result.notes,
        scannedAt: new Date(),
      },
    });
    await writeAudit(
      {
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: "storage.scan_rejected",
        entityType: stored.assetId ? "Asset" : "VisualAsset",
        entityId: (stored.assetId ?? stored.visualAssetId)!,
        metadata: { storedFileId, reason: result.notes },
      },
      tx,
    );
    return updated;
  });
}

// Removes a REJECTED file's quarantined bytes and record so a fresh upload
// can be attempted. Never removes a CLEAN (in-use) file through this path.
export async function discardRejectedFile(actor: Actor, storedFileId: string) {
  require_(actor, "storage.upload");
  const stored = await prisma.storedFile.findUnique({ where: { id: storedFileId } });
  if (!stored || stored.workspaceId !== actor.workspaceId) throw notFound("Stored file not found");
  if (stored.quarantineStatus !== "REJECTED") {
    throw forbidden("Only a rejected file may be discarded");
  }
  const storage = getAssetStorage();
  await storage.remove(stored.storagePath).catch((err: unknown) => {
    console.warn(`storage: failed to remove rejected file ${stored.storagePath}:`, err);
  });
  await prisma.storedFile.delete({ where: { id: storedFileId } });
  await writeAudit({
    workspaceId: actor.workspaceId,
    actorId: actor.userId,
    action: "storage.discarded",
    entityType: stored.assetId ? "Asset" : "VisualAsset",
    entityId: (stored.assetId ?? stored.visualAssetId)!,
    metadata: { storedFileId },
  });
}
