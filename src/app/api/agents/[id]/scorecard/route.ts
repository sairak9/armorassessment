import { NextResponse } from "next/server";
import { getAgentScorecard } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const data = getAgentScorecard(id);

  if (!data) {
    return NextResponse.json(
      { error: "agent_not_found", id },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
