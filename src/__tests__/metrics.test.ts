// Metric calculation tests for the ArmorHQ dashboard.
//
// Each test creates an in-memory SQLite database with a controlled dataset so
// results are fully deterministic and don't depend on the real data.db file.
// The functions under test accept an optional `db` parameter for exactly this
// purpose — see src/lib/data.ts.

import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  getConnectedLast7Days,
  getConnectedPrior7Days,
  getAgentLeaderboard,
  getDailyActivity,
} from "../lib/data";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const schema = fs.readFileSync(path.join(process.cwd(), "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

function addAgent(db: DatabaseSync, id: string, team = "TestTeam"): void {
  db.prepare(
    "INSERT INTO agents (id, name, team, hire_date) VALUES (?, ?, ?, ?)",
  ).run(id, `Agent ${id}`, team, "2024-01-01");
}

// daysAgo > 0 = past, daysAgo < 0 = future (for edge-case tests)
function addCall(
  db: DatabaseSync,
  agentId: string,
  outcome: string,
  daysAgo: number,
): void {
  const ts = new Date(Date.now() - daysAgo * 86400_000).toISOString();
  const ended = outcome === "failed" ? null : ts;
  const dur = outcome === "failed" ? 0 : 60;
  db.prepare(
    "INSERT INTO calls (id, agent_id, customer_phone, started_at, ended_at, duration_seconds, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(randomUUID(), agentId, "+15551234567", ts, ended, dur, outcome);
}

// ── getConnectedLast7Days ─────────────────────────────────────────────────────

describe("getConnectedLast7Days", () => {
  it("counts only connected calls within the last 7 days", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addCall(db, "a1", "connected", 1); // ✓ in window
    addCall(db, "a1", "connected", 6); // ✓ in window
    addCall(db, "a1", "connected", 8); // ✗ too old
    addCall(db, "a1", "voicemail", 2); // ✗ wrong outcome
    addCall(db, "a1", "no_answer", 3); // ✗ wrong outcome
    addCall(db, "a1", "busy", 1); //     ✗ wrong outcome
    expect(getConnectedLast7Days(db)).toBe(2);
  });

  it("excludes future-dated calls", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addCall(db, "a1", "connected", 1);  // ✓ yesterday
    addCall(db, "a1", "connected", -1); // ✗ tomorrow
    expect(getConnectedLast7Days(db)).toBe(1);
  });

  it("returns zero when there are no calls at all", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    expect(getConnectedLast7Days(db)).toBe(0);
  });

  it("returns zero when all connected calls are older than 7 days", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addCall(db, "a1", "connected", 8);
    addCall(db, "a1", "connected", 14);
    expect(getConnectedLast7Days(db)).toBe(0);
  });

  it("counts calls from multiple agents", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addAgent(db, "a2");
    addCall(db, "a1", "connected", 2);
    addCall(db, "a2", "connected", 3);
    addCall(db, "a2", "connected", 5);
    expect(getConnectedLast7Days(db)).toBe(3);
  });
});

// ── getConnectedPrior7Days ────────────────────────────────────────────────────

describe("getConnectedPrior7Days", () => {
  it("counts connected calls in the 8–14 day window only", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addCall(db, "a1", "connected", 9);  // ✓ prior window
    addCall(db, "a1", "connected", 13); // ✓ prior window
    addCall(db, "a1", "connected", 2);  // ✗ current week
    addCall(db, "a1", "connected", 15); // ✗ too old
    expect(getConnectedPrior7Days(db)).toBe(2);
  });

  it("excludes non-connected outcomes in the prior window", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addCall(db, "a1", "connected", 10);
    addCall(db, "a1", "voicemail", 10);
    addCall(db, "a1", "no_answer", 10);
    expect(getConnectedPrior7Days(db)).toBe(1);
  });
});

// ── getAgentLeaderboard ───────────────────────────────────────────────────────

describe("getAgentLeaderboard", () => {
  it("sorts agents by connected_7 descending", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addAgent(db, "a2");
    // a2 gets more connects this week
    addCall(db, "a1", "connected", 1);
    addCall(db, "a2", "connected", 1);
    addCall(db, "a2", "connected", 2);
    const rows = getAgentLeaderboard(db);
    expect(rows[0].id).toBe("a2");
    expect(rows[0].connected_7).toBe(2);
    expect(rows[1].id).toBe("a1");
    expect(rows[1].connected_7).toBe(1);
  });

  it("marks trend as 'down' when connect rate drops significantly week over week", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    // Prior 7 days: 8 connected / 10 total → 80%
    for (let i = 0; i < 8; i++) addCall(db, "a1", "connected", 8 + (i % 5));
    for (let i = 0; i < 2; i++) addCall(db, "a1", "voicemail", 8 + i);
    // Current 7 days: 2 connected / 10 total → 20% (big drop)
    for (let i = 0; i < 2; i++) addCall(db, "a1", "connected", 1 + i);
    for (let i = 0; i < 8; i++) addCall(db, "a1", "voicemail", 1 + i);

    const rows = getAgentLeaderboard(db);
    expect(rows[0].trend).toBe("down");
  });

  it("marks trend as 'up' when connect rate improves significantly", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    // Prior: 2 connected / 10 total → 20%
    for (let i = 0; i < 2; i++) addCall(db, "a1", "connected", 8 + i);
    for (let i = 0; i < 8; i++) addCall(db, "a1", "voicemail", 8 + i);
    // Current: 8 connected / 10 total → 80%
    for (let i = 0; i < 8; i++) addCall(db, "a1", "connected", 1 + (i % 5));
    for (let i = 0; i < 2; i++) addCall(db, "a1", "voicemail", 1 + i);

    const rows = getAgentLeaderboard(db);
    expect(rows[0].trend).toBe("up");
  });

  it("includes agents with zero calls this week", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    addAgent(db, "a2");
    addCall(db, "a1", "connected", 1);
    // a2 has no calls this week
    const rows = getAgentLeaderboard(db);
    expect(rows).toHaveLength(2);
    const a2Row = rows.find((r) => r.id === "a2");
    expect(a2Row?.connected_7).toBe(0);
    expect(a2Row?.total_7).toBe(0);
  });
});

// ── getDailyActivity ──────────────────────────────────────────────────────────

describe("getDailyActivity", () => {
  it("returns exactly `days` entries in ascending date order", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    const rows = getDailyActivity(7, db);
    expect(rows).toHaveLength(7);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].date > rows[i - 1].date).toBe(true);
    }
  });

  it("fills missing days with zeros", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    // Only one day of calls — the rest should be zero-filled
    addCall(db, "a1", "connected", 3);
    const rows = getDailyActivity(7, db);
    const zeroRows = rows.filter((r) => r.total_count === 0);
    expect(zeroRows.length).toBe(6);
  });

  it("aggregates multiple calls on the same day correctly", () => {
    const db = makeTestDb();
    addAgent(db, "a1");
    // 3 calls on "1 day ago", 2 connected + 1 voicemail
    addCall(db, "a1", "connected", 1);
    addCall(db, "a1", "connected", 1);
    addCall(db, "a1", "voicemail", 1);
    const rows = getDailyActivity(7, db);
    const todayRow = rows[rows.length - 2]; // index 5 = 1 day ago
    expect(todayRow.total_count).toBe(3);
    expect(todayRow.connected_count).toBe(2);
  });
});
