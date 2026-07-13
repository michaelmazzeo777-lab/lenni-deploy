import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { require_ } from "@/lib/permissions";
import { precondition, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/auth/context";
import { evaluateReadyReadiness } from "@/domain/approval";
import { gatherContentState } from "@/domain/content";
import { PublicationChannel, PublicationStatus, ContentStatus } from "@prisma/client";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Public slugs must be globally unique across articles. If another content item
// already published under this slug, disambiguate with a stable suffix.
async function resolveUniqueSlug(tx: Tx, contentId: string, base: string): Promise<string> {
  const clash = await tx.publicArticleRevision.findFirst({
    where: { slug: base, contentId: { not: contentId } },
  });
  if (!clash) return base;
  return `${base}-${contentId.slice(-6)}`;
}

interface ArticleBuild {
  title: string;
  slug: string;
  summary: string;
  body: string;
  sourceSnapshot: unknown;
  claimSnapshot: unknown;
}

// Builds the article payload from the approved content state. Fact
// classifications are preserved from the claim records (docs/01 Epic 4).
async function buildArticle(contentId: string, tx: Tx, slug: string): Promise<ArticleBuild> {
  const { content, currentScript } = await gatherContentState(contentId, tx);
  const links = await tx.contentClaim.findMany({
    where: { contentId },
    include: { claim: { include: { sources: { include: { source: true } } } } },
    orderBy: { sortOrder: "asc" },
  });

  const claimSnapshot = links.map((l) => ({
    id: l.claim.id,
    classification: l.claim.classification,
    statement: l.claim.statement,
    publicWording: l.claim.publicWording,
  }));

  const sourceMap = new Map<
    string,
    { id: string; title: string; publisher: string; url: string | null }
  >();
  for (const l of links) {
    for (const cs of l.claim.sources) {
      sourceMap.set(cs.source.id, {
        id: cs.source.id,
        title: cs.source.title,
        publisher: cs.source.publisher,
        url: cs.source.url ?? null,
      });
    }
  }
  const sourceSnapshot = [...sourceMap.values()];

  const title = content.publicTitle ?? content.workingTitle;
  const evidenceLines = links
    .map((l) => `- **${l.claim.classification}** — ${l.claim.publicWording ?? l.claim.statement}`)
    .join("\n");

  const body = [
    currentScript?.body?.trim() || content.viewerPromise || "",
    "",
    "## Evidence",
    evidenceLines,
  ].join("\n");

  return {
    title,
    slug,
    summary: content.viewerPromise ?? `Evidence-graded guide: ${title}`,
    body,
    sourceSnapshot,
    claimSnapshot,
  };
}

// Publishes the approved content as an immutable public article revision.
// Idempotent: re-publishing the same approved state returns the existing revision.
export async function publishPublicArticle(actor: Actor, contentId: string) {
  require_(actor, "publication.publish");

  return prisma.$transaction(async (tx) => {
    const content = await tx.contentItem.findUnique({ where: { id: contentId } });
    if (!content || content.workspaceId !== actor.workspaceId)
      throw notFound("Content item not found");

    const readiness = await evaluateReadyReadiness(contentId, tx);
    if (!readiness.ready) {
      throw precondition("Content is not READY for publication", readiness);
    }
    const { hash } = await gatherContentState(contentId, tx);

    // Idempotency: if the current revision already reflects this exact hash, reuse it.
    const existingPub = await tx.publication.findUnique({
      where: { contentId_channel: { contentId, channel: PublicationChannel.PUBLIC_WEBSITE } },
    });
    const lastRevision = await tx.publicArticleRevision.findFirst({
      where: { contentId },
      orderBy: { revision: "desc" },
    });
    if (
      existingPub?.status === PublicationStatus.PUBLISHED &&
      existingPub.externalId === hash &&
      lastRevision
    ) {
      return { revision: lastRevision, publication: existingPub, idempotent: true };
    }

    const slug = await resolveUniqueSlug(
      tx,
      contentId,
      content.slug ?? slugify(content.publicTitle ?? content.workingTitle),
    );
    const article = await buildArticle(contentId, tx, slug);
    const nextRevisionNumber = (lastRevision?.revision ?? 0) + 1;

    const revision = await tx.publicArticleRevision.create({
      data: {
        contentId,
        revision: nextRevisionNumber,
        title: article.title,
        slug: article.slug,
        summary: article.summary,
        body: article.body,
        sourceSnapshot: article.sourceSnapshot as object,
        claimSnapshot: article.claimSnapshot as object,
        disclaimer: content.workingTitle ? DISCLAIMER : DISCLAIMER,
        spoilerLevel: content.spoilerLevel,
        pillar: content.pillar,
        lastVerifiedAt: new Date(),
        approvedBy: actor.userId,
        approvedAt: new Date(),
      },
    });

    const publicUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/guides/${article.slug}`;

    const publication = await tx.publication.upsert({
      where: { contentId_channel: { contentId, channel: PublicationChannel.PUBLIC_WEBSITE } },
      create: {
        contentId,
        channel: PublicationChannel.PUBLIC_WEBSITE,
        status: PublicationStatus.PUBLISHED,
        publicUrl,
        externalId: hash,
        publishedAt: new Date(),
        recordedBy: actor.userId,
      },
      update: {
        status: PublicationStatus.PUBLISHED,
        publicUrl,
        externalId: hash,
        publishedAt: new Date(),
        recordedBy: actor.userId,
      },
    });

    // Ensure a stable public slug on the content item.
    if (!content.slug) {
      await tx.contentItem.update({ where: { id: contentId }, data: { slug: article.slug } });
    }
    if (content.status !== ContentStatus.PUBLISHED) {
      await tx.contentItem.update({
        where: { id: contentId },
        data: { status: ContentStatus.PUBLISHED },
      });
      await tx.contentStatusHistory.create({
        data: {
          contentId,
          fromStatus: content.status,
          toStatus: ContentStatus.PUBLISHED,
          actorId: actor.userId,
          reason: "Published to local public website",
        },
      });
    }

    await writeAudit(
      {
        workspaceId: content.workspaceId,
        actorId: actor.userId,
        action: "publication.published",
        entityType: "ContentItem",
        entityId: contentId,
        metadata: { channel: "PUBLIC_WEBSITE", revision: nextRevisionNumber, publicUrl },
      },
      tx,
    );

    return { revision, publication, idempotent: false };
  });
}

const DISCLAIMER =
  "Leonida Field Guide is an independent fan publication and is not affiliated with, endorsed by, sponsored by, or operated by Rockstar Games or Take-Two Interactive. Grand Theft Auto, GTA, GTA VI, Rockstar Games, and related names, marks, characters, footage, and artwork belong to their respective owners.";
