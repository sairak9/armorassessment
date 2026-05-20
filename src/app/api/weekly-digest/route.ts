import { NextResponse } from "next/server";
import { getWeeklyDigest } from "@/lib/data";

export const dynamic = "force-dynamic";

export function GET() {
  const data = getWeeklyDigest();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
