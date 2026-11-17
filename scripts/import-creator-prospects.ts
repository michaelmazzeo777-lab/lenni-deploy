// Imports researched creator prospects (research/*.json) into the candidate's
// own database as PROSPECTs. Contacts nobody. Refuses any database other than
// localhost:5433/fgcand_dev.
//   pnpm exec tsx scripts/import-creator-prospects.ts research/creator-prospects-20261117.json
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";
import { prisma } from "../lib/db";
import { createCreator } from "../domain/creatorRights";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://x@invalid/none");
  if (url.port !== "5433" || url.pathname !== "/fgcand_dev") {
    throw new Error(
      `Refusing: DATABASE_URL must be localhost:5433/fgcand_dev (got ${url.host}${url.pathname})`,
    );
  }
  const file = process.argv[2];
  if (!file) throw new Error("Pass the research JSON file");
  const data = JSON.parse(readFileSync(file, "utf8")) as { creators: Record<string, unknown>[] };
  const owner = await prisma.user.findFirstOrThrow({
    where: { roles: { some: { role: Role.OWNER } } },
    include: { roles: true },
  });
  const actor = {
    userId: owner.id,
    workspaceId: owner.workspaceId,
    displayName: owner.displayName,
    email: owner.email,
    roles: owner.roles.map((r) => r.role),
  };
  let added = 0;
  for (const c of data.creators) {
    const exists = await prisma.creator.findFirst({
      where: { workspaceId: actor.workspaceId, profileUrl: String(c.profileUrl) },
    });
    if (exists) continue;
    await createCreator(actor, c as never);
    added++;
  }
  console.log(`Imported ${added} prospect(s); ${data.creators.length - added} already present.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
