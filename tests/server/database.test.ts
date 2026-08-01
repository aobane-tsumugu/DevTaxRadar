import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSession } from "../../src/server/sessionAggregation.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite persistence", () => {
  it("stores normalized metadata in an isolated application directory", () => {
    const dataDirectory = mkdtempSync(joinTempPrefix("devtax-db-"));
    temporaryDirectories.push(dataDirectory);

    const stdout = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("tests/server/helpers/database-probe.ts"),
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...process.env,
          DEVTAX_RADAR_DATA_DIR: dataDirectory,
        },
      },
    );
    const result = JSON.parse(stdout) as {
      databaseExists: boolean;
      overview: {
        providers: Array<Record<string, string | number>>;
        recentScans: Array<Record<string, string | number>>;
      };
    };

    expect(result.databaseExists).toBe(true);
    expect(result.overview.providers).toEqual([
      expect.objectContaining({
        provider: "claude",
        month: "2026-04",
        sessions: 1,
        projects: 1,
        inputTokens: 100,
        outputTokens: 20,
      }),
    ]);
    expect(result.overview.recentScans[0]).toEqual(
      expect.objectContaining({
        provider: "claude",
        filesSeen: 1,
        eventsWritten: 1,
        malformedLines: 0,
        status: "complete",
      }),
    );
  });
});

function joinTempPrefix(name: string): string {
  return `${tmpdir()}${process.platform === "win32" ? "\\" : "/"}${name}`;
}

const diagnostics = { filesSeen: 1, malformedLines: 0 };

function session(overrides: Partial<UsageSession> = {}): UsageSession {
  return {
    provider: "claude",
    sessionKey: "session_a",
    projectKey: "project_a",
    month: "2026-07",
    startedAt: "2026-07-15T10:00:00.000Z",
    endedAt: "2026-07-15T11:00:00.000Z",
    messageCount: 2,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    schemaVersion: "test-v1",
    confidence: "medium",
    ...overrides,
  };
}

describe("session storage", () => {
  let sessionDirectory: string;
  let db: typeof import("../../src/server/database.ts");

  beforeEach(async () => {
    sessionDirectory = mkdtempSync(joinTempPrefix("devtax-db-session-"));
    process.env.DEVTAX_RADAR_DATA_DIR = sessionDirectory;
    vi.resetModules();
    db = await import("../../src/server/database.ts");
  });

  afterEach(() => {
    db.getDatabase().close();
    delete process.env.DEVTAX_RADAR_DATA_DIR;
    rmSync(sessionDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });

  it("同じセッションを二重に保存しない", () => {
    db.replaceProviderSessions("claude", [session(), session()], diagnostics);
    expect(db.getUsageSessions()).toHaveLength(1);
  });

  it("再スキャンで置き換えてもトークンが失われない", () => {
    db.replaceProviderSessions("claude", [session({ inputTokens: 100 })], diagnostics);
    db.replaceProviderSessions("claude", [session({ inputTokens: 250 })], diagnostics);
    const rows = db.getUsageSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inputTokens).toBe(250);
  });

  it("生参照はopt-inしたときだけ保存する", () => {
    db.replaceProviderSessions("claude", [session()], diagnostics);
    expect(db.getSessionReference("claude", "session_a")).toBeUndefined();

    db.replaceProviderSessions("claude", [session({
      localReference: {
        nativeSessionId: "native-1",
        sourcePath: "/tmp/a.jsonl",
        workingDirectory: "/tmp/work",
      },
    })], diagnostics);
    expect(db.getSessionReference("claude", "session_a")).toMatchObject({
      nativeSessionId: "native-1",
      workingDirectory: "/tmp/work",
    });
  });

  it("セッション行に開始日時と終了日時を保持する", () => {
    db.replaceProviderSessions("claude", [session()], diagnostics);
    const row = db.getUsageSessions()[0];
    expect(row?.startedAt).toBe("2026-07-15T10:00:00.000Z");
    expect(row?.endedAt).toBe("2026-07-15T11:00:00.000Z");
  });

  it("旧スキーマを検出して作り直し、time_zoneを追加し、2回起動しても失敗しない", async () => {
    // v0.1.0以前の実際のスキーマを直接組み立てる: メッセージ単位のusage_events
    // （started_atがない）と、time_zoneのないscans。
    const databasePath = join(sessionDirectory, "devtax-radar.db");
    const raw = new DatabaseSync(databasePath);
    raw.exec(`
      CREATE TABLE scans (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        files_seen INTEGER NOT NULL DEFAULT 0,
        events_written INTEGER NOT NULL DEFAULT 0,
        malformed_lines INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL
      ) STRICT;
      CREATE TABLE usage_events (
        id INTEGER PRIMARY KEY,
        provider TEXT NOT NULL,
        month TEXT NOT NULL,
        session_key TEXT NOT NULL,
        project_key TEXT NOT NULL,
        project_label TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        observed_at TEXT,
        schema_version TEXT NOT NULL,
        confidence TEXT NOT NULL,
        UNIQUE(provider, session_key, month, project_key, observed_at)
      ) STRICT;
    `);
    raw.prepare(`
      INSERT INTO scans(provider, started_at, completed_at, files_seen, events_written, malformed_lines, status)
      VALUES ('claude', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:01.000Z', 1, 1, 0, 'complete')
    `).run();
    raw.close();

    // 起動その1: dbは既にimport済み（beforeEach）。getDatabase()が旧スキーマを検出して作り直す。
    const firstStart = db.getDatabase();
    const usageColumns = (firstStart.prepare(`PRAGMA table_info(usage_events)`).all() as Array<{ name: string }>)
      .map((column) => column.name);
    const scanColumns = (firstStart.prepare(`PRAGMA table_info(scans)`).all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(usageColumns).toContain("started_at");
    expect(scanColumns).toContain("time_zone");
    expect(
      (firstStart.prepare(`SELECT COUNT(*) AS n FROM scans`).get() as { n: number }).n,
    ).toBe(1);

    // 起動その2: モジュールを再importして新しいDatabaseSyncを同じファイルへ開く。
    // 既に現行スキーマのため、ALTER/DROPガードは何もせず、例外も投げない。
    vi.resetModules();
    const restarted = await import("../../src/server/database.ts");
    expect(() => restarted.getDatabase()).not.toThrow();
    expect(
      (restarted.getDatabase().prepare(`SELECT COUNT(*) AS n FROM scans`).get() as { n: number }).n,
    ).toBe(1);
    restarted.getDatabase().close();
  });

  it("planning_project_rulesのtax_unit_id NOT NULLを検出して作り直し、planning_tax_unitsを失わない", () => {
    // v0.1.0以前のレガシースキーマ: tax_unit_idがNOT NULLのplanning_project_rulesと、
    // それが実際に参照するplanning_tax_unitsの行を1件ずつ用意する。
    // 外部キー制約が有効な状態でplanning_project_rules（子テーブル）をDROPしても、
    // planning_tax_units（親テーブル）の行は失われないことを確認する。
    const databasePath = join(sessionDirectory, "devtax-radar.db");
    const raw = new DatabaseSync(databasePath);
    raw.exec(`
      CREATE TABLE planning_tax_units (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit_type TEXT NOT NULL,
        usage_mode TEXT NOT NULL,
        revenue_model TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        journey_mode TEXT NOT NULL DEFAULT 'early',
        monetization_status TEXT NOT NULL DEFAULT 'planned',
        completion_criteria TEXT,
        predecessor_id TEXT,
        same_as_external_version TEXT,
        notes TEXT
      ) STRICT;
      CREATE TABLE planning_project_rules (
        id TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        provider TEXT,
        effective_from TEXT NOT NULL,
        effective_to TEXT,
        tax_unit_id TEXT NOT NULL REFERENCES planning_tax_units(id),
        classification TEXT NOT NULL,
        reason TEXT
      ) STRICT;
    `);
    raw.prepare(`
      INSERT INTO planning_tax_units(id, name, unit_type, usage_mode, revenue_model, lifecycle_status)
      VALUES ('unit-legacy', 'レガシー制作物', 'new-software', 'internal', 'undecided', 'idea')
    `).run();
    raw.prepare(`
      INSERT INTO planning_project_rules(id, project_key, effective_from, tax_unit_id, classification)
      VALUES ('rule-legacy', 'project_legacy_0001', '2026-01-01', 'unit-legacy', 'new-development')
    `).run();
    raw.close();

    // dbは既にimport済み（beforeEach）。getDatabase()が旧スキーマを検出して作り直す。
    const firstStart = db.getDatabase();
    const projectRuleColumns = firstStart.prepare(`PRAGMA table_info(planning_project_rules)`)
      .all() as Array<{ name: string; notnull: number }>;
    const taxUnitIdColumn = projectRuleColumns.find((column) => column.name === "tax_unit_id");
    expect(taxUnitIdColumn?.notnull).toBe(0);
    expect(
      (firstStart.prepare(`SELECT COUNT(*) AS n FROM planning_tax_units`).get() as { n: number }).n,
    ).toBe(1);
    expect(() => firstStart.prepare(`
      INSERT INTO planning_project_rules(id, project_key, effective_from, tax_unit_id, classification)
      VALUES ('rule-private', 'project_private_0001', '2026-01-01', NULL, 'private')
    `).run()).not.toThrow();
  });

  it("旧project_mappingsをplanning_project_rulesへ移行し、テーブル自体を削除する", () => {
    // v0.1.0以前のレガシースキーマ: project_key単位の分類だけを持つproject_mappings。
    // product_nameは制作物ではなく、フォルダに付けた表示名にすぎないため移行しない。
    const databasePath = join(sessionDirectory, "devtax-radar.db");
    const raw = new DatabaseSync(databasePath);
    raw.exec(`
      CREATE TABLE project_mappings (
        project_key TEXT PRIMARY KEY,
        product_name TEXT NOT NULL,
        asset_name TEXT NOT NULL,
        classification TEXT NOT NULL
      ) STRICT;
    `);
    raw.prepare(`
      INSERT INTO project_mappings(project_key, product_name, asset_name, classification)
      VALUES ('project_legacy_mapping_0001', '旧プロダクト名', '旧資産名', 'maintenance')
    `).run();
    raw.close();

    // dbは既にimport済み（beforeEach）。getDatabase()が旧テーブルを検出して移行し、削除する。
    const firstStart = db.getDatabase();

    const tableExists = firstStart.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_mappings'`,
    ).get();
    expect(tableExists).toBeUndefined();

    const migratedRule = firstStart.prepare(`
      SELECT project_key AS projectKey, tax_unit_id AS taxUnitId, classification, reason
      FROM planning_project_rules WHERE project_key = 'project_legacy_mapping_0001'
    `).get() as { projectKey: string; taxUnitId: string | null; classification: string; reason: string | null } | undefined;
    expect(migratedRule).toEqual({
      projectKey: "project_legacy_mapping_0001",
      taxUnitId: null,
      classification: "maintenance",
      reason: "旧設定から移行",
    });
  });

  it("再スキャンで消えたセッションの参照が残らない", () => {
    db.replaceProviderSessions("claude", [
      session({
        sessionKey: "session_a",
        localReference: { nativeSessionId: "native-a", sourcePath: "/a.jsonl", workingDirectory: "/work/a" },
      }),
      session({
        sessionKey: "session_b",
        projectKey: "project_b",
        localReference: { nativeSessionId: "native-b", sourcePath: "/b.jsonl", workingDirectory: "/work/b" },
      }),
    ], diagnostics);

    db.replaceProviderSessions("claude", [
      session({
        sessionKey: "session_a",
        localReference: { nativeSessionId: "native-a", sourcePath: "/a.jsonl", workingDirectory: "/work/a" },
      }),
    ], diagnostics);

    expect(db.getSessionReference("claude", "session_a")).toMatchObject({ nativeSessionId: "native-a" });
    expect(db.getSessionReference("claude", "session_b")).toBeUndefined();
  });
});
