import { getWeeklyDigest } from "@/lib/data";

export const dynamic = "force-dynamic";

// Wraps a value in double-quotes if it contains a comma, double-quote, or newline.
function csvCell(value: string): string {
  if (/[,"\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function GET() {
  const { data } = getWeeklyDigest();

  const header = "date,connected_count,total_count,top_team,top_team_connects";
  const rows = data.map((row) => {
    // Find the team with the most connected calls on this day
    let topTeam = "";
    let topTeamConnects = 0;
    for (const [team, count] of Object.entries(row.by_team)) {
      if (count > topTeamConnects) {
        topTeam = team;
        topTeamConnects = count;
      }
    }
    return [
      row.date,
      row.connected_count,
      row.total_count,
      csvCell(topTeam),
      topTeamConnects,
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Cache-Control": "no-store",
    },
  });
}
