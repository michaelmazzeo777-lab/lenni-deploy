import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { isDomainError } from "@/lib/errors";
import { buildHandoffPacket, handoffToMarkdown } from "@/domain/handoff";

// Download-only production handoff (Markdown or JSON). Never sent externally.
export async function GET(req: NextRequest, ctx: { params: Promise<{ contentId: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { contentId } = await ctx.params;
  try {
    const packet = await buildHandoffPacket(actor, contentId);
    if (req.nextUrl.searchParams.get("format") === "json") {
      return new NextResponse(JSON.stringify(packet, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="handoff-${contentId}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return new NextResponse(handoffToMarkdown(packet), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="handoff-${contentId}.md"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (isDomainError(e)) {
      const status = e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
