// Central data layer for the ArmorHQ dashboard.
//
// All dashboard pages and API routes call these functions — never SQLite
// directly. Each function accepts an optional `db` parameter that defaults to
// the singleton from `getDb()`. Passing an in-memory database in tests lets
// us verify the SQL logic against a controlled dataset without touching the
// real data.db file.

import { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";

// ── Private helpers ───────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function isoNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

// Returns YYYY-MM-DD for the date N calendar days ago (UTC).
function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

// ── Public types ──────────────────────────────────────────────────────────────

export type DailyRow = {
  date: string; // YYYY-MM-DD
  connected_count: number;
  total_count: number;
};

export type AgentLeaderboardRow = {
  id: string;
  name: string;
  team: string;
  connected_7: number;
  total_7: number;
  rate_7: number; // 0–1
  connected_prior: number;
  total_prior: number;
  rate_prior: number; // 0–1
  trend: "up" | "down" | "flat";
  // "top"   → meaningfully above the team average, not declining
  // "watch" → meaningfully below the team average (Dana should talk to them)
  flag: "top" | "watch" | null;
};

export type TeamRow = {
  name: string;
  agent_count: number;
  connected_7: number;
  total_7: number;
  rate: number; // 0–1
};

// ── Dashboard queries ─────────────────────────────────────────────────────────

/**
 * The number Dana checks every Monday: calls whose outcome is 'connected' and
 * whose started_at falls within the rolling last 7 days from right now.
 *
 * The upper bound (now) explicitly excludes the two future-dated seed rows so
 * the number is never inflated by test data.
 */
export function getConnectedLast7Days(db: DatabaseSync = getDb()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM calls
       WHERE outcome = 'connected' AND started_at >= ? AND started_at <= ?`,
    )
    .get(isoNDaysAgo(7), nowIso()) as { n: number };
  return row.n;
}

/** Connected calls in the previous 7-day window (days 8–14 ago) for WoW delta. */
export function getConnectedPrior7Days(db: DatabaseSync = getDb()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM calls
       WHERE outcome = 'connected' AND started_at >= ? AND started_at < ?`,
    )
    .get(isoNDaysAgo(14), isoNDaysAgo(7)) as { n: number };
  return row.n;
}

/**
 * Returns one row per calendar day for the last `days` days, oldest first.
 * Days with zero calls are filled with 0 so charts have no gaps.
 */
export function getDailyActivity(days: number, db: DatabaseSync = getDb()): DailyRow[] {
  type Raw = { day: string; connected_count: number; total_count: number };
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', started_at) AS day,
              COUNT(CASE WHEN outcome = 'connected' THEN 1 END) AS connected_count,
              COUNT(*) AS total_count
       FROM calls
       WHERE started_at >= ? AND started_at <= ?
       GROUP BY day`,
    )
    .all(isoNDaysAgo(days), nowIso()) as Raw[];

  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const d = dateNDaysAgo(days - 1 - i);
    const r = byDay.get(d);
    return {
      date: d,
      connected_count: r?.connected_count ?? 0,
      total_count: r?.total_count ?? 0,
    };
  });
}

/**
 * All agents ranked by connected calls this week, with trend direction and an
 * attention flag ("top" / "watch" / null) based on connect rate vs average.
 *
 * Flag thresholds:
 *   top   → rate ≥ 110% of average AND not declining
 *   watch → rate ≤ 85% of average (regardless of trend — Dana should know)
 *
 * Agents with fewer than 5 calls this week are excluded from flagging because
 * the rate would be too noisy to be meaningful.
 */
export function getAgentLeaderboard(db: DatabaseSync = getDb()): AgentLeaderboardRow[] {
  const now = nowIso();
  const c7 = isoNDaysAgo(7);
  const c14 = isoNDaysAgo(14);

  type Raw = {
    id: string;
    name: string;
    team: string;
    connected_7: number;
    total_7: number;
    connected_prior: number;
    total_prior: number;
  };

  // Single query with conditional aggregates is cheaper than 4 separate queries
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.team,
         COUNT(CASE WHEN c.outcome='connected' AND c.started_at>=? AND c.started_at<=? THEN 1 END) AS connected_7,
         COUNT(CASE WHEN c.started_at>=? AND c.started_at<=? THEN 1 END) AS total_7,
         COUNT(CASE WHEN c.outcome='connected' AND c.started_at>=? AND c.started_at<? THEN 1 END) AS connected_prior,
         COUNT(CASE WHEN c.started_at>=? AND c.started_at<? THEN 1 END) AS total_prior
       FROM agents a LEFT JOIN calls c ON c.agent_id = a.id
       GROUP BY a.id
       ORDER BY connected_7 DESC, a.name ASC`,
    )
    .all(c7, now, c7, now, c14, c7, c14, c7) as Raw[];

  // Average connect rate across agents who made ≥5 calls (noisy agents skipped)
  const active = rows.filter((r) => r.total_7 >= 5);
  const avgRate =
    active.length > 0
      ? active.reduce((s, r) => s + r.connected_7 / r.total_7, 0) / active.length
      : 0;

  return rows.map((r) => {
    const rate_7 = r.total_7 > 0 ? r.connected_7 / r.total_7 : 0;
    const rate_prior = r.total_prior > 0 ? r.connected_prior / r.total_prior : 0;
    const rateChange = rate_7 - rate_prior;
    const trend: "up" | "down" | "flat" =
      rateChange > 0.02 ? "up" : rateChange < -0.02 ? "down" : "flat";

    const enoughCalls = r.total_7 >= 5;
    const flag: "top" | "watch" | null =
      enoughCalls && rate_7 >= avgRate * 1.1 && trend !== "down"
        ? "top"
        : enoughCalls && rate_7 <= avgRate * 0.85
          ? "watch"
          : null;

    return { ...r, rate_7, rate_prior, trend, flag };
  });
}

/** Team call volume and connect rate for the last 7 days, sorted by volume desc. */
export function getTeamBreakdown(db: DatabaseSync = getDb()): TeamRow[] {
  const now = nowIso();
  const c7 = isoNDaysAgo(7);

  type Raw = { team: string; agent_count: number; connected_7: number; total_7: number };
  const rows = db
    .prepare(
      `SELECT a.team,
         COUNT(DISTINCT a.id) AS agent_count,
         COUNT(CASE WHEN c.outcome='connected' AND c.started_at>=? AND c.started_at<=? THEN 1 END) AS connected_7,
         COUNT(CASE WHEN c.started_at>=? AND c.started_at<=? THEN 1 END) AS total_7
       FROM agents a LEFT JOIN calls c ON c.agent_id = a.id
       GROUP BY a.team ORDER BY connected_7 DESC`,
    )
    .all(c7, now, c7, now) as Raw[];

  return rows.map((r) => ({
    name: r.team,
    agent_count: r.agent_count,
    connected_7: r.connected_7,
    total_7: r.total_7,
    rate: r.total_7 > 0 ? r.connected_7 / r.total_7 : 0,
  }));
}

// ── API-specific query types and functions ────────────────────────────────────

export type WeeklyDigestData = {
  data: Array<{
    date: string;
    connected_count: number;
    total_count: number;
    by_team: Record<string, number>;
  }>;
  top_agents: Array<{ name: string; team: string; connected_count: number }>;
  meta: { generated_at: string; window_start: string; window_end: string };
};

/** Last 28 days of overall activity plus top 3 agents by connected calls. */
export function getWeeklyDigest(db: DatabaseSync = getDb()): WeeklyDigestData {
  const now = nowIso();
  const c28 = isoNDaysAgo(28);
  const c7 = isoNDaysAgo(7);

  type DayRaw = { day: string; connected_count: number; total_count: number };
  const dayRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', started_at) AS day,
              COUNT(CASE WHEN outcome='connected' THEN 1 END) AS connected_count,
              COUNT(*) AS total_count
       FROM calls WHERE started_at >= ? AND started_at <= ?
       GROUP BY day`,
    )
    .all(c28, now) as DayRaw[];

  type TeamDayRaw = { day: string; team: string; connected_count: number };
  const teamDayRows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', c.started_at) AS day,
              a.team,
              COUNT(*) AS connected_count
       FROM calls c JOIN agents a ON a.id = c.agent_id
       WHERE c.outcome='connected' AND c.started_at >= ? AND c.started_at <= ?
       GROUP BY day, a.team`,
    )
    .all(c28, now) as TeamDayRaw[];

  const byDay = new Map(dayRows.map((r) => [r.day, r]));
  const teamByDay = new Map<string, Record<string, number>>();
  for (const r of teamDayRows) {
    if (!teamByDay.has(r.day)) teamByDay.set(r.day, {});
    teamByDay.get(r.day)![r.team] = r.connected_count;
  }

  const data = Array.from({ length: 28 }, (_, i) => {
    const d = dateNDaysAgo(27 - i);
    const dr = byDay.get(d);
    return {
      date: d,
      connected_count: dr?.connected_count ?? 0,
      total_count: dr?.total_count ?? 0,
      by_team: teamByDay.get(d) ?? {},
    };
  });

  type AgentRaw = { name: string; team: string; connected_count: number };
  const topAgents = db
    .prepare(
      `SELECT a.name, a.team, COUNT(*) AS connected_count
       FROM calls c JOIN agents a ON a.id = c.agent_id
       WHERE c.outcome='connected' AND c.started_at >= ? AND c.started_at <= ?
       GROUP BY a.id ORDER BY connected_count DESC LIMIT 3`,
    )
    .all(c7, now) as AgentRaw[];

  return {
    data,
    top_agents: topAgents,
    meta: {
      generated_at: new Date().toISOString(),
      window_start: dateNDaysAgo(28),
      window_end: dateNDaysAgo(0),
    },
  };
}

export type AgentScorecardData = {
  agent: { id: string; name: string; team: string; hire_date: string };
  last_14_days: DailyRow[];
  totals: {
    connected_last_7: number;
    connected_prior_7: number;
    connect_rate_last_7: number;
  };
  meta: { generated_at: string; window_start: string; window_end: string };
};

/** One agent's call history and totals for the last 14 days. Returns null if id is unknown. */
export function getAgentScorecard(
  id: string,
  db: DatabaseSync = getDb(),
): AgentScorecardData | null {
  const agent = db
    .prepare(`SELECT id, name, team, hire_date FROM agents WHERE id = ?`)
    .get(id) as { id: string; name: string; team: string; hire_date: string } | undefined;

  if (!agent) return null;

  const now = nowIso();
  const c14 = isoNDaysAgo(14);
  const c7 = isoNDaysAgo(7);

  type DayRaw = { day: string; connected_count: number; total_count: number };
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', started_at) AS day,
              COUNT(CASE WHEN outcome='connected' THEN 1 END) AS connected_count,
              COUNT(*) AS total_count
       FROM calls WHERE agent_id = ? AND started_at >= ? AND started_at <= ?
       GROUP BY day`,
    )
    .all(id, c14, now) as DayRaw[];

  const byDay = new Map(rows.map((r) => [r.day, r]));
  const last_14_days: DailyRow[] = Array.from({ length: 14 }, (_, i) => {
    const d = dateNDaysAgo(13 - i);
    const r = byDay.get(d);
    return {
      date: d,
      connected_count: r?.connected_count ?? 0,
      total_count: r?.total_count ?? 0,
    };
  });

  type TotRaw = {
    connected_last_7: number;
    total_last_7: number;
    connected_prior_7: number;
  };
  const totals = db
    .prepare(
      `SELECT
         COUNT(CASE WHEN outcome='connected' AND started_at>=? AND started_at<=? THEN 1 END) AS connected_last_7,
         COUNT(CASE WHEN started_at>=? AND started_at<=? THEN 1 END) AS total_last_7,
         COUNT(CASE WHEN outcome='connected' AND started_at>=? AND started_at<? THEN 1 END) AS connected_prior_7
       FROM calls WHERE agent_id = ?`,
    )
    .get(c7, now, c7, now, c14, c7, id) as TotRaw;

  return {
    agent,
    last_14_days,
    totals: {
      connected_last_7: totals.connected_last_7,
      connected_prior_7: totals.connected_prior_7,
      connect_rate_last_7:
        totals.total_last_7 > 0 ? totals.connected_last_7 / totals.total_last_7 : 0,
    },
    meta: {
      generated_at: new Date().toISOString(),
      window_start: dateNDaysAgo(14),
      window_end: dateNDaysAgo(0),
    },
  };
}

export type TeamSummaryData = {
  team: { name: string; agent_count: number };
  last_7_days: { connected_count: number; total_count: number; connect_rate: number };
  agents: Array<{ id: string; name: string; connected_count: number; total_count: number }>;
  meta: { generated_at: string; window_start: string; window_end: string };
};

/** One team's roll-up and per-agent breakdown for the last 7 days. Returns null if no agents on team. */
export function getTeamSummary(
  name: string,
  db: DatabaseSync = getDb(),
): TeamSummaryData | null {
  const now = nowIso();
  const c7 = isoNDaysAgo(7);

  type AgentRaw = {
    id: string;
    name: string;
    connected_count: number;
    total_count: number;
  };
  const agents = db
    .prepare(
      `SELECT a.id, a.name,
         COUNT(CASE WHEN c.outcome='connected' AND c.started_at>=? AND c.started_at<=? THEN 1 END) AS connected_count,
         COUNT(CASE WHEN c.started_at>=? AND c.started_at<=? THEN 1 END) AS total_count
       FROM agents a LEFT JOIN calls c ON c.agent_id = a.id
       WHERE a.team = ?
       GROUP BY a.id ORDER BY connected_count DESC`,
    )
    .all(c7, now, c7, now, name) as AgentRaw[];

  if (agents.length === 0) return null;

  const connected = agents.reduce((s, a) => s + a.connected_count, 0);
  const total = agents.reduce((s, a) => s + a.total_count, 0);

  return {
    team: { name, agent_count: agents.length },
    last_7_days: {
      connected_count: connected,
      total_count: total,
      connect_rate: total > 0 ? connected / total : 0,
    },
    agents,
    meta: {
      generated_at: new Date().toISOString(),
      window_start: dateNDaysAgo(7),
      window_end: dateNDaysAgo(0),
    },
  };
}
