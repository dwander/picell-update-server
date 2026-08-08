// 부팅 시 스키마를 멱등하게 맞춘다. 관리 전용 단일 인스턴스라 마이그레이션 파일
// 체계 대신 "있으면 통과, 없으면 생성" 방식이 운영상 단순하고 안전하다.
// 운영 DB에는 구 버전의 downloads 테이블과 데이터가 이미 있으므로, 신규 컬럼은
// ALTER ADD COLUMN으로 덧붙인다(기존 다운로드 이력 보존).

import { rawDb } from "./index.js";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS releases (
     id TEXT PRIMARY KEY,
     version TEXT NOT NULL,
     channel TEXT NOT NULL DEFAULT 'stable',
     name TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'draft',
     mandatory INTEGER NOT NULL DEFAULT 0,
     min_supported_version TEXT,
     rollout_percent INTEGER NOT NULL DEFAULT 100,
     published_at INTEGER,
     created_at INTEGER NOT NULL DEFAULT (unixepoch()),
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
     id TEXT PRIMARY KEY,
     release_id TEXT NOT NULL,
     platform TEXT NOT NULL,
     arch TEXT NOT NULL DEFAULT 'x64',
     kind TEXT NOT NULL DEFAULT 'installer',
     file_name TEXT NOT NULL,
     storage_key TEXT NOT NULL,
     size INTEGER NOT NULL DEFAULT 0,
     sha256 TEXT,
     content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
     status TEXT NOT NULL DEFAULT 'uploading',
     created_at INTEGER NOT NULL DEFAULT (unixepoch()),
     uploaded_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS changelogs (
     id TEXT PRIMARY KEY,
     release_id TEXT NOT NULL,
     locale TEXT NOT NULL DEFAULT 'ko',
     summary TEXT NOT NULL DEFAULT '',
     body_markdown TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE TABLE IF NOT EXISTS changelog_items (
     id TEXT PRIMARY KEY,
     release_id TEXT NOT NULL,
     locale TEXT NOT NULL DEFAULT 'ko',
     type TEXT NOT NULL DEFAULT 'added',
     text TEXT NOT NULL,
     sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS downloads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     version TEXT NOT NULL,
     platform TEXT NOT NULL,
     channel TEXT NOT NULL DEFAULT 'stable',
     arch TEXT,
     release_id TEXT,
     artifact_id TEXT,
     ip TEXT,
     user_agent TEXT,
     machine_id TEXT,
     downloaded_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE TABLE IF NOT EXISTS installs (
     machine_id TEXT PRIMARY KEY,
     version TEXT NOT NULL,
     channel TEXT NOT NULL DEFAULT 'stable',
     platform TEXT NOT NULL,
     arch TEXT,
     ip TEXT,
     user_agent TEXT,
     first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
     last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
     check_count INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS check_log (
     day TEXT NOT NULL,
     machine_id TEXT NOT NULL,
     version TEXT NOT NULL,
     channel TEXT NOT NULL DEFAULT 'stable',
     platform TEXT NOT NULL,
     arch TEXT,
     checks INTEGER NOT NULL DEFAULT 1,
     first_at INTEGER NOT NULL DEFAULT (unixepoch()),
     last_at INTEGER NOT NULL DEFAULT (unixepoch()),
     PRIMARY KEY (day, machine_id)
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     created_at INTEGER NOT NULL DEFAULT (unixepoch()),
     expires_at INTEGER NOT NULL,
     ip TEXT,
     user_agent TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     action TEXT NOT NULL,
     target TEXT,
     detail TEXT,
     ip TEXT,
     created_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
];

const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS releases_version_uq ON releases (version)`,
  `CREATE INDEX IF NOT EXISTS releases_channel_status_idx ON releases (channel, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS artifacts_storage_key_uq ON artifacts (storage_key)`,
  `CREATE INDEX IF NOT EXISTS artifacts_release_idx ON artifacts (release_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS changelogs_release_locale_uq ON changelogs (release_id, locale)`,
  `CREATE INDEX IF NOT EXISTS changelog_items_release_locale_idx ON changelog_items (release_id, locale)`,
  `CREATE INDEX IF NOT EXISTS downloads_version_machine_idx ON downloads (version, machine_id)`,
  `CREATE INDEX IF NOT EXISTS downloads_at_idx ON downloads (downloaded_at)`,
  `CREATE INDEX IF NOT EXISTS installs_last_seen_idx ON installs (last_seen_at)`,
  `CREATE INDEX IF NOT EXISTS check_log_machine_idx ON check_log (machine_id)`,
  `CREATE INDEX IF NOT EXISTS audit_logs_at_idx ON audit_logs (created_at)`,
];

/** 구 버전 테이블에 뒤늦게 추가된 컬럼들 — 이미 있으면 조용히 통과. */
const ADD_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "downloads", column: "machine_id", ddl: "TEXT" },
  { table: "downloads", column: "channel", ddl: "TEXT NOT NULL DEFAULT 'stable'" },
  { table: "downloads", column: "arch", ddl: "TEXT" },
  { table: "downloads", column: "release_id", ddl: "TEXT" },
  { table: "downloads", column: "artifact_id", ddl: "TEXT" },
];

function hasColumn(table: string, column: string): boolean {
  const rows = rawDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

export function migrate(): void {
  for (const sql of TABLES) rawDb.exec(sql);
  for (const { table, column, ddl } of ADD_COLUMNS) {
    if (!hasColumn(table, column)) {
      rawDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }
  for (const sql of INDEXES) rawDb.exec(sql);
  seedCheckLog();
}

/**
 * 활동 로그 도입 전에 쌓인 `installs`를 최근 확인 시각 하루치로 옮겨 심는다.
 * 없으면 새 통계 화면이 며칠간 텅 빈 채로 보여 "집계가 안 되나" 오해를 부른다.
 * 로그가 비어 있을 때만 돈다 — 운영 중 다시 돌아 과거를 덮어쓰는 일이 없도록.
 */
function seedCheckLog(): void {
  const existing = rawDb.prepare(`SELECT count(*) AS n FROM check_log`).get() as { n: number };
  if (existing.n > 0) return;
  rawDb.exec(
    `INSERT OR IGNORE INTO check_log
       (day, machine_id, version, channel, platform, arch, checks, first_at, last_at)
     SELECT date(last_seen_at, 'unixepoch'), machine_id, version, channel, platform, arch,
            check_count, last_seen_at, last_seen_at
       FROM installs`,
  );
}
