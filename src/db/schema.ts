import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

// ─── 릴리즈 ──────────────────────────────────────────────────────────────────
// 릴리즈 메타의 1차 출처는 이 DB지만, 실제 바이너리는 R2(picell-one)에 있고
// 릴리즈 매니페스트도 R2에 미러링된다(services/manifest.ts). DB가 유실돼도
// 매니페스트로 복구할 수 있게 하기 위함 — Railway 볼륨 사고 대비.

export const releases = sqliteTable(
  "releases",
  {
    id: text("id").primaryKey(),
    /** 정규화된 semver (선행 v 없음) */
    version: text("version").notNull(),
    /** stable | beta */
    channel: text("channel").notNull().default("stable"),
    /** 표시용 이름. 비면 UI가 버전으로 대체한다. */
    name: text("name").notNull().default(""),
    /** draft | published | archived — archived는 클라이언트에 절대 노출되지 않는다(철회). */
    status: text("status").notNull().default("draft"),
    /** 강제 업데이트 여부 */
    mandatory: integer("mandatory", { mode: "boolean" }).notNull().default(false),
    /** 이 버전 미만은 강제 업데이트 대상 (없으면 mandatory 플래그만 적용) */
    minSupportedVersion: text("min_supported_version"),
    /** 단계적 배포 비율 0~100. machineId 해시로 결정론적 분배. */
    rolloutPercent: integer("rollout_percent").notNull().default(100),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("releases_version_uq").on(t.version),
    index("releases_channel_status_idx").on(t.channel, t.status),
  ],
);

// ─── 아티팩트 (R2 오브젝트) ──────────────────────────────────────────────────

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id").notNull(),
    /** windows | macos | linux */
    platform: text("platform").notNull(),
    /** x64 | arm64 | universal */
    arch: text("arch").notNull().default("x64"),
    /** installer | portable | zip | blockmap | other */
    kind: text("kind").notNull().default("installer"),
    fileName: text("file_name").notNull(),
    /** R2 논리 키 (환경 프리픽스 제외) */
    storageKey: text("storage_key").notNull(),
    size: integer("size").notNull().default(0),
    sha256: text("sha256"),
    contentType: text("content_type").notNull().default("application/octet-stream"),
    /** uploading | ready — uploading 상태는 클라이언트에 노출되지 않는다. */
    status: text("status").notNull().default("uploading"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("artifacts_storage_key_uq").on(t.storageKey),
    index("artifacts_release_idx").on(t.releaseId),
  ],
);

// ─── 체인지로그 ──────────────────────────────────────────────────────────────
// 릴리즈×로케일당 1행. 항목(changelogItems)에서 마크다운을 생성하되, bodyMarkdown에
// 직접 쓴 내용이 있으면 그쪽이 우선한다 — 편집기에서 모드를 오가도 데이터가 사라지지
// 않도록 "비어 있지 않으면 우선" 규칙만 쓴다.

export const changelogs = sqliteTable(
  "changelogs",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id").notNull(),
    /** ko | en */
    locale: text("locale").notNull().default("ko"),
    /** 한 줄 요약 (업데이트 다이얼로그 헤드라인) */
    summary: text("summary").notNull().default(""),
    /** 직접 작성한 마크다운. 비어 있으면 항목에서 생성. */
    bodyMarkdown: text("body_markdown").notNull().default(""),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("changelogs_release_locale_uq").on(t.releaseId, t.locale)],
);

export const changelogItems = sqliteTable(
  "changelog_items",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id").notNull(),
    locale: text("locale").notNull().default("ko"),
    /** added | improved | changed | fixed | removed | security */
    type: text("type").notNull().default("added"),
    text: text("text").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("changelog_items_release_locale_idx").on(t.releaseId, t.locale)],
);

// ─── 통계 ────────────────────────────────────────────────────────────────────

export const downloads = sqliteTable(
  "downloads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    version: text("version").notNull(),
    platform: text("platform").notNull(),
    channel: text("channel").notNull().default("stable"),
    arch: text("arch"),
    releaseId: text("release_id"),
    artifactId: text("artifact_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    machineId: text("machine_id"),
    downloadedAt: integer("downloaded_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("downloads_version_machine_idx").on(t.version, t.machineId),
    index("downloads_at_idx").on(t.downloadedAt),
  ],
);

/** 업데이트 확인 핑에서 파생되는 설치 기반 현황. machineId당 1행으로 upsert한다. */
export const installs = sqliteTable(
  "installs",
  {
    machineId: text("machine_id").primaryKey(),
    version: text("version").notNull(),
    channel: text("channel").notNull().default("stable"),
    platform: text("platform").notNull(),
    arch: text("arch"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    checkCount: integer("check_count").notNull().default(1),
  },
  (t) => [index("installs_last_seen_idx").on(t.lastSeenAt)],
);

/**
 * 업데이트 확인 활동 로그 — **지우지 않는 영구 기록**.
 *
 * `installs`는 machineId당 1행이라 "지금 몇 대가 살아 있나"만 알 수 있고 과거 활동은
 * 덮여 사라진다. 활성 사용자 추이(오늘/7일/30일)를 보려면 시간축이 남아야 한다.
 *
 * 매 요청 1행이 아니라 **(날짜 × machineId)당 1행**이다. 클라이언트는 하루에도 여러 번
 * 확인하므로 요청마다 남기면 행 수가 확인 주기에 끌려 다니고, 활성 사용자 판정에는
 * "그날 살아 있었나"만 있으면 충분하다. 이 형태면 행 수가 (설치 대수 × 운영 일수)로
 * 묶여 영구 보존해도 SQLite 파일이 감당한다.
 */
export const checkLog = sqliteTable(
  "check_log",
  {
    /** YYYY-MM-DD (UTC). 기존 일별 집계가 전부 UTC라 기준을 맞춘다. */
    day: text("day").notNull(),
    machineId: text("machine_id").notNull(),
    /** 그날 마지막으로 보고된 현재 사용 버전 */
    version: text("version").notNull(),
    channel: text("channel").notNull().default("stable"),
    platform: text("platform").notNull(),
    arch: text("arch"),
    /** 그날 들어온 확인 횟수 */
    checks: integer("checks").notNull().default(1),
    firstAt: integer("first_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastAt: integer("last_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    // (day, machine_id) 복합 PK가 날짜 범위 조회용 인덱스를 겸한다(day가 선두 컬럼).
    primaryKey({ columns: [t.day, t.machineId] }),
    // PC별 활동 일수 조회는 machine_id로 들어오므로 별도 인덱스가 필요하다.
    index("check_log_machine_idx").on(t.machineId),
  ],
);

// ─── 운영 ────────────────────────────────────────────────────────────────────

/** 관리 콘솔 세션. 토큰은 해시로만 저장한다(DB 유출 시 세션 탈취 방지). */
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail"),
    ip: text("ip"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("audit_logs_at_idx").on(t.createdAt)],
);

export type ReleaseRow = typeof releases.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type ChangelogRow = typeof changelogs.$inferSelect;
export type ChangelogItemRow = typeof changelogItems.$inferSelect;
export type InstallRow = typeof installs.$inferSelect;
export type CheckLogRow = typeof checkLog.$inferSelect;
