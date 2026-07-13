import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { buildExport, type ExportType, type ExportFormat } from "@/lib/export";

const TYPES: ExportType[] = ["claims", "sources", "content", "audit"];

export async function GET(req: NextRequest, ctx: { params: Promise<{ type: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { type } = await ctx.params;
  if (!TYPES.includes(type as ExportType)) {
    return NextResponse.json({ error: "Unknown export type" }, { status: 404 });
  }
  const format = (
    req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv"
  ) as ExportFormat;

  const { body, contentType, filename } = await buildExport(actor, type as ExportType, format);
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
