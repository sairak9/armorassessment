import { NextResponse } from "next/server";
import { getTeamSummary } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ name: string }> }) {
  // Team names arrive URL-encoded (e.g. "West%20Coast" → "West Coast")
  const { name } = await context.params;
  const teamName = decodeURIComponent(name);
  const data = getTeamSummary(teamName);

  if (!data) {
    return NextResponse.json(
      { error: "team_not_found", name: teamName },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
