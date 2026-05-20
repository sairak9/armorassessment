import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getConnectedLast7Days,
  getConnectedPrior7Days,
  getDailyActivity,
  getAgentLeaderboard,
  getTeamBreakdown,
  type AgentLeaderboardRow,
  type DailyRow,
  type TeamRow,
} from "@/lib/data";

export const dynamic = "force-dynamic";

// ── Formatting helpers ────────────────────────────────────────────────────────

function pct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

function wowDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

// ── SVG: 14-day daily activity bar chart ──────────────────────────────────────
// Each day renders two bars sharing the same X origin:
//   • dim gray  = total calls  (background)
//   • indigo    = connected    (foreground)
// The overlap creates a "fill rate" visual — if 30% connected, the indigo bar
// is 30% of the gray bar's height. A dashed line divides last week / this week.

function DailyActivityChart({ rows }: { rows: DailyRow[] }) {
  const W = 560;
  const H = 96;
  const LABEL_H = 20;
  const maxTotal = Math.max(...rows.map((r) => r.total_count), 1);
  const n = rows.length;
  const slotW = W / n;
  const barW = slotW * 0.62;
  const barOffset = (slotW - barW) / 2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H + LABEL_H}`}
      className="w-full"
      aria-label="Daily call activity — last 14 days"
    >
      {rows.map((row, i) => {
        const x = i * slotW + barOffset;
        const totalH = (row.total_count / maxTotal) * H;
        const connH = (row.connected_count / maxTotal) * H;
        // Show a label every other day to avoid crowding
        const showLabel = i % 2 === 0;
        const label = row.date.slice(5).replace("-", "/");

        return (
          <g key={row.date}>
            {/* Total calls bar */}
            <rect
              x={x}
              y={H - totalH}
              width={barW}
              height={totalH}
              fill="rgba(255,255,255,0.07)"
              rx={2}
            />
            {/* Connected calls bar */}
            <rect
              x={x}
              y={H - connH}
              width={barW}
              height={connH}
              fill="#6366f1"
              rx={2}
            />
            {showLabel && (
              <text
                x={x + barW / 2}
                y={H + LABEL_H - 2}
                textAnchor="middle"
                fill="rgba(230,231,236,0.35)"
                fontSize={8}
                fontFamily="monospace"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
      {/* Divider between "last week" and "this week" */}
      <line
        x1={7 * slotW}
        y1={0}
        x2={7 * slotW}
        y2={H}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        x={7 * slotW - 6}
        y={10}
        textAnchor="end"
        fill="rgba(230,231,236,0.3)"
        fontSize={7}
        fontFamily="monospace"
      >
        PREV
      </text>
      <text
        x={7 * slotW + 6}
        y={10}
        textAnchor="start"
        fill="rgba(230,231,236,0.3)"
        fontSize={7}
        fontFamily="monospace"
      >
        THIS WK
      </text>
    </svg>
  );
}

// ── SVG: week-over-week mini bar comparison ───────────────────────────────────

function WoWBars({ current, prior }: { current: number; prior: number }) {
  const max = Math.max(current, prior, 1);
  const W = 80;
  const H = 32;
  const bw = 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-20" aria-hidden="true">
      {/* Prior week */}
      <rect
        x={6}
        y={H - (prior / max) * H}
        width={bw}
        height={(prior / max) * H}
        fill="rgba(255,255,255,0.15)"
        rx={2}
      />
      {/* Current week */}
      <rect
        x={6 + bw + 8}
        y={H - (current / max) * H}
        width={bw}
        height={(current / max) * H}
        fill={current >= prior ? "#22c55e" : "#ef4444"}
        rx={2}
      />
      <text x={6 + bw / 2} y={H - 2} textAnchor="middle" fill="rgba(230,231,236,0.35)" fontSize={6} fontFamily="monospace">PREV</text>
      <text x={6 + bw + 8 + bw / 2} y={H - 2} textAnchor="middle" fill="rgba(230,231,236,0.35)" fontSize={6} fontFamily="monospace">NOW</text>
    </svg>
  );
}

// ── Team horizontal bars ──────────────────────────────────────────────────────

function TeamBars({ teams }: { teams: TeamRow[] }) {
  const maxConnected = Math.max(...teams.map((t) => t.connected_7), 1);
  const colors = ["#6366f1", "#22c55e", "#f59e0b", "#06b6d4"];

  return (
    <div className="space-y-4">
      {teams.map((team, i) => (
        <div key={team.name}>
          <div className="flex items-center justify-between mb-1 gap-2">
            <span className="text-sm font-medium text-foreground truncate">{team.name}</span>
            <span className="text-xs font-mono text-muted shrink-0">
              {team.connected_7} connected · {pct(team.rate)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(team.connected_7 / maxConnected) * 100}%`,
                backgroundColor: colors[i % colors.length],
              }}
            />
          </div>
          <div className="text-xs text-muted mt-0.5">{team.agent_count} agents · {team.total_7} total calls</div>
        </div>
      ))}
    </div>
  );
}

// ── Agent status badge ────────────────────────────────────────────────────────

function StatusBadge({ flag }: { flag: AgentLeaderboardRow["flag"] }) {
  if (flag === "top") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/20">
        Top
      </span>
    );
  }
  if (flag === "watch") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/20">
        Watch
      </span>
    );
  }
  return null;
}

// ── Trend indicator ───────────────────────────────────────────────────────────

function TrendArrow({ trend }: { trend: AgentLeaderboardRow["trend"] }) {
  if (trend === "up") return <span className="text-green-400 font-bold">↑</span>;
  if (trend === "down") return <span className="text-red-400 font-bold">↓</span>;
  return <span className="text-muted">→</span>;
}

// ── Monday Morning attention panel ────────────────────────────────────────────

function AttentionPanel({ agents }: { agents: AgentLeaderboardRow[] }) {
  const watches = agents.filter((a) => a.flag === "watch");
  const tops = agents.filter((a) => a.flag === "top");
  if (watches.length === 0 && tops.length === 0) return null;

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {watches.length > 0 && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            Talk to these agents on Monday
          </h2>
          <ul className="space-y-2">
            {watches.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded bg-black/20 px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{a.name}</div>
                  <div className="text-xs text-muted">{a.team}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-semibold text-red-400">{pct(a.rate_7)}</div>
                  <div className="text-xs text-muted">
                    {a.trend === "down" ? "↓ declining" : "below avg"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tops.length > 0 && (
        <div className="rounded-lg border border-green-500/25 bg-green-500/5 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-green-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
            Top performers this week
          </h2>
          <ul className="space-y-2">
            {tops.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded bg-black/20 px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{a.name}</div>
                  <div className="text-xs text-muted">{a.team}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-mono font-semibold text-green-400">{pct(a.rate_7)}</div>
                  <div className="text-xs text-muted">
                    {a.connected_7} connected
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── Agent connect-rate mini bar (inline in table) ─────────────────────────────

function RateBar({ rate, avgRate }: { rate: number; avgRate: number }) {
  const color =
    rate >= avgRate * 1.1 ? "#22c55e" : rate <= avgRate * 0.85 ? "#ef4444" : "#6366f1";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden shrink-0">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(rate * 100 / 50, 1) * 100}%`, backgroundColor: color }}
        />
      </div>
      <span
        className="text-xs font-mono tabular-nums"
        style={{ color }}
      >
        {pct(rate)}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Page() {
  const connected7 = getConnectedLast7Days();
  const prior7 = getConnectedPrior7Days();
  const daily14 = getDailyActivity(14);
  const agents = getAgentLeaderboard();
  const teams = getTeamBreakdown();

  // Derive totals from daily data to avoid extra queries
  const total7 = daily14.slice(7).reduce((s, r) => s + r.total_count, 0);
  const rate7 = total7 > 0 ? connected7 / total7 : 0;
  const topTeam = teams[0];

  const delta = wowDelta(connected7, prior7);
  const deltaPositive = delta !== null && delta >= 0;

  // Average rate across agents who made ≥5 calls (used for rate bar scaling)
  const active = agents.filter((a) => a.total_7 >= 5);
  const avgRate =
    active.length > 0
      ? active.reduce((s, a) => s + a.rate_7, 0) / active.length
      : 0;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-border px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-content items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="ArmorHQ"
              width={140}
              height={36}
              className="h-8 w-auto object-contain"
              priority
            />
          </div>
          <span className="font-mono text-xs text-muted">{today}</span>
        </div>
      </header>

      <main className="mx-auto max-w-content space-y-6 px-4 py-6 sm:px-6 sm:py-8">

        {/* ── KPI cards ─────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">

          {/* THE Monday number */}
          <Card className="col-span-2 lg:col-span-1 relative overflow-hidden">
            <CardContent className="p-4 sm:p-5">
              <div className="text-xs font-mono uppercase tracking-widest text-muted mb-2">
                Connected · Last 7 Days
              </div>
              <div className="flex items-end gap-3">
                <span className="text-5xl font-bold tabular-nums leading-none text-foreground">
                  {connected7.toLocaleString()}
                </span>
                <WoWBars current={connected7} prior={prior7} />
              </div>
              <div className="mt-2 flex items-center gap-1 text-sm">
                {delta !== null ? (
                  <>
                    <span className={deltaPositive ? "text-green-400" : "text-red-400"}>
                      {deltaPositive ? "↑" : "↓"} {Math.abs(delta).toFixed(1)}%
                    </span>
                    <span className="text-muted">vs last week ({prior7.toLocaleString()})</span>
                  </>
                ) : (
                  <span className="text-muted">no prior week data</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Total calls */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <div className="text-xs font-mono uppercase tracking-widest text-muted mb-2">
                Total Calls · 7d
              </div>
              <div className="text-3xl font-bold tabular-nums text-foreground">
                {total7.toLocaleString()}
              </div>
              <div className="text-xs text-muted mt-2">across all agents</div>
            </CardContent>
          </Card>

          {/* Connect rate */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <div className="text-xs font-mono uppercase tracking-widest text-muted mb-2">
                Connect Rate · 7d
              </div>
              <div className="text-3xl font-bold tabular-nums text-foreground">
                {pct(rate7)}
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${rate7 * 100}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Top team */}
          <Card>
            <CardContent className="p-4 sm:p-5">
              <div className="text-xs font-mono uppercase tracking-widest text-muted mb-2">
                Leading Team · 7d
              </div>
              {topTeam ? (
                <>
                  <div className="text-xl font-bold text-foreground leading-tight">
                    {topTeam.name}
                  </div>
                  <div className="text-xs text-muted mt-2">
                    {topTeam.connected_7} connected · {pct(topTeam.rate)} rate
                  </div>
                </>
              ) : (
                <div className="text-muted text-sm">—</div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Monday morning intel ──────────────────────────────────────── */}
        <AttentionPanel agents={agents} />

        {/* ── Charts row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">

          {/* Daily activity — wider */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted">
                14-Day Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <DailyActivityChart rows={daily14} />
              <div className="mt-2 flex items-center gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm bg-white/10" />
                  Total calls
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-3 rounded-sm bg-accent" />
                  Connected
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Team breakdown — narrower */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted">
                Teams · Last 7 Days
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-4 pb-4">
              <TeamBars teams={teams} />
            </CardContent>
          </Card>
        </div>

        {/* ── Agent performance table ───────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-baseline justify-between gap-2">
              <CardTitle className="text-sm font-medium text-muted">
                Agent Performance · Last 7 Days
              </CardTitle>
              <span className="text-xs text-muted font-mono">avg rate {pct(avgRate)}</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 pl-4">#</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Connected</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Total</TableHead>
                  <TableHead className="hidden md:table-cell">Rate</TableHead>
                  <TableHead className="text-center hidden sm:table-cell">Trend</TableHead>
                  <TableHead className="pr-4 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent, i) => {
                  const isWatch = agent.flag === "watch";
                  const isTop = agent.flag === "top";
                  return (
                    <TableRow
                      key={agent.id}
                      className={
                        isWatch
                          ? "bg-red-500/5 border-l-2 border-l-red-500/40"
                          : isTop
                            ? "bg-indigo-500/5 border-l-2 border-l-indigo-500/40"
                            : ""
                      }
                    >
                      <TableCell className="pl-4 font-mono text-xs text-muted w-6">
                        {i + 1}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground text-sm leading-tight">
                          {agent.name}
                        </div>
                        <div className="text-xs text-muted">{agent.team}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold text-foreground">
                        {agent.connected_7}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted text-sm hidden sm:table-cell">
                        {agent.total_7}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {agent.total_7 > 0 ? (
                          <RateBar rate={agent.rate_7} avgRate={avgRate} />
                        ) : (
                          <span className="text-xs text-muted">no calls</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center hidden sm:table-cell">
                        <TrendArrow trend={agent.trend} />
                        {agent.total_7 > 0 && (
                          <span className="ml-1 text-xs font-mono text-muted">
                            {agent.rate_prior > 0
                              ? `${((agent.rate_7 - agent.rate_prior) * 100) >= 0 ? "+" : ""}${((agent.rate_7 - agent.rate_prior) * 100).toFixed(1)}pp`
                              : "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <StatusBadge flag={agent.flag} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </main>

      <footer className="border-t border-border px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-content text-xs text-muted font-mono">
          Live data · refreshes on every page load
        </div>
      </footer>
    </div>
  );
}
