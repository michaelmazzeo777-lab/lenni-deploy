// Adds the canonical v1.3 pilot queue (4 long + 8 Shorts) to the existing
// workspace and writes 21_Pilot_Content_Queue_v1_0.md from the same data.
// ADDITIVE and idempotent: nothing is truncated; items that already exist
// (matched by their "[PILOT v1.3 <id>]" title prefix) are left untouched. The
// July demo seed (3 long + 9 Shorts) stays as historical demo data.
// Usage: pnpm pilot:queue
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { createContent } from "@/domain/content";
import { PILOT_QUEUE, REJECTED, score, type PilotItem } from "./pilot-queue-v1_3";

const RECHECK_DATE = "2026-11-15";
const tag = (i: PilotItem) => `[PILOT v1.3 ${i.id}]`;

function markdown(): string {
  const row = (i: PilotItem) =>
    `| ${i.id} | ${i.title} | ${i.canonicalPillar} | ${i.targetLength} | ${i.factors.join(" / ")} | -${i.penalty} | **${score(i)}** | ${i.claimIds.join(", ")} |`;
  const detail = (i: PilotItem) =>
    `### ${i.id} — ${i.title}${i.initialSelection ? "  (INITIAL SELECTION)" : ""}\n` +
    `- Viewer: ${i.viewer}\n- Problem: ${i.problem}\n- Promise: ${i.promise}\n` +
    `- Spoiler ceiling: S0 (none) · Format: ${i.format === "LONG" ? "long-form" : "Short"}, ${i.targetLength}\n` +
    `- Visual/proof plan: ${i.visualPlan}\n- Penalty (-${i.penalty}): ${i.penaltyReason}\n`;
  const head =
    "| ID | Working title | Pillar | Length | Factors (20/20/15/15/10/10/10) | Penalty | Score | Claim IDs |\n|---|---|---|---|---|---:|---:|---|";
  const long = PILOT_QUEUE.filter((i) => i.format === "LONG");
  const shorts = PILOT_QUEUE.filter((i) => i.format === "SHORT");
  const first = PILOT_QUEUE.filter((i) => i.initialSelection);
  return `# 21 — Pilot Content Queue v1.0

**Status:** PROPOSED — Draft — Pending editor-in-chief / Mike review · internal packet pilot only (APP-PILOT-001) · **PUBLICATION_BLOCKED**
**Generated:** ${RECHECK_DATE} from \`prisma/pilot-queue-v1_3.ts\` (same data the Studio queue is built from)
**Scoring:** reference 02 Channel Strategy Charter, "Topic score and rejection" (0–100, minus up to 40). The charter defines no numeric cut-off, so candidates are ranked and cut at four long-form and eight Shorts. Scores are editorial proposals, not measurements.

## Initial selection (one long-form + two Shorts)

${first.map((i) => `- **${i.id}** (${score(i)}) — ${i.title}`).join("\n")}

Why these: highest-scoring items whose proof plan is original graphics only (no unowned footage), and PILOT-L1 rests on the one ledger claim still inside its freshness window.

## Long-form (4)

${head}
${long.map(row).join("\n")}

## Shorts (8)

${head}
${shorts.map(row).join("\n")}

## Packet detail

${PILOT_QUEUE.map(detail).join("\n")}
## Rejected and deferred candidates

| Format | Candidate | Score | Charter rule | Reason |
|---|---|---:|---|---|
${REJECTED.map((r) => `| ${r.format === "LONG" ? "Long" : "Short"} | ${r.title} | ${r.score ?? "rejected regardless of score"} | ${r.rule} | ${r.reason} |`).join("\n")}

## Freshness recheck — ${RECHECK_DATE}

Every GTA VI claim in the ledger was accessed 2026-07-20 with a 24h or 7d TTL, so **all of them are past TTL** and must be re-opened by a human before any script is locked. Only \`GTA-UNI-001\` (365d) is inside its window. One automated read of the official pages on ${RECHECK_DATE} found:

| Ledger claim | Ledger wording | Official page today | Disposition |
|---|---|---|---|
| GTA6-REL-001 | Scheduled for November 19, 2026 | "Coming November 19, 2026" | Still supported; re-stamp |
| GTA6-PLAT-001 | PS5 and Xbox Series X\\|S | Same platforms shown | Still supported; re-stamp |
| GTA6-PRE-002 / GTA6-PHYS-001 | Preload begins November 12 | Newswire (Nov 3): "Pre-Load Begins on November 10" | **STALE_OR_CONTRADICTED** — add a replacement claim, keep the old ID linked |
| GTA6-RATE-001 / GTA6-RATE-002 | Not yet rated / "Rating Pending Likely Mature" | ESRB Mature mark with descriptors shown | **STALE_OR_CONTRADICTED** — add a replacement claim |
| GTA6-PRICE-*, GTA6-UPGRADE-001, GTA6-GTAPLUS-* | July U.S. storefront terms | Prices not shown on the main page | Not rechecked — open the storefront pages |

Sources read: https://www.rockstargames.com/VI · https://www.rockstargames.com/newswire/article/k4ak9okk485712/grand-theft-auto-vi-pre-load-begins-on-november-10 · https://www.rockstargames.com/newswire/article/ak3ak31a49a221/grand-theft-auto-vi-is-now-set-to-launch-november-19-2026

This was a single machine-summarized read, not a human source review: exact wording, dates and regional terms still need a person to open each page. References 01–20 were **not** edited; record replacements in the working ledger with new IDs and contradiction links.

## What this queue does not claim

- No item is approved, scripted, captured or rights-cleared. No \`OBSERVED_IN_GAME\` claim exists; none can before an owned release-build capture.
- The Studio's older demo seed (3 long + 9 Shorts) is not this pilot and is left in place as demo data.
- Launch is November 19, 2026: prerelease framing in PILOT-L2, PILOT-L3, PILOT-S7 and PILOT-S8 must be re-scored after launch.
`;
}

async function main() {
  const email = process.env.PILOT_OWNER_EMAIL ?? "owner@leonida.test";
  const user = await prisma.user.findFirst({ where: { email }, include: { roles: true } });
  if (!user) throw new Error(`No user ${email}; run the app's normal setup first`);
  const actor = {
    userId: user.id,
    workspaceId: user.workspaceId,
    displayName: user.displayName,
    email: user.email,
    roles: user.roles.map((r) => r.role),
  };

  let created = 0;
  for (const i of PILOT_QUEUE) {
    const exists = await prisma.contentItem.findFirst({
      where: { workspaceId: actor.workspaceId, workingTitle: { startsWith: tag(i) } },
    });
    if (exists) continue;
    const item = await createContent(actor, {
      type: i.format === "LONG" ? "LONG_VIDEO" : "SHORT",
      pillar: i.repoPillar,
      workingTitle: `${tag(i)} ${i.title}`,
      viewerPromise: i.promise,
      priority: i.initialSelection ? 1 : 3,
      spoilerLevel: "NONE",
    });
    await prisma.contentItem.update({
      where: { id: item.id },
      data: {
        targetLength: i.targetLength,
        audienceIntent:
          `${i.viewer}. Problem: ${i.problem} Canonical pillar: ${i.canonicalPillar}. ` +
          `Topic score ${score(i)}/100 (PROPOSED). Claims: ${i.claimIds.join(", ")}.`,
      },
    });
    created++;
  }

  const doc = path.resolve(process.env.PILOT_DOC_PATH ?? "../21_Pilot_Content_Queue_v1_0.md");
  await writeFile(doc, markdown());
  console.log(
    `Pilot queue: ${created} created, ${PILOT_QUEUE.length - created} already present. Doc: ${doc}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
