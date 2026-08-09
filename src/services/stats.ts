import { db } from "../db/index.js";
import { checkLog, downloads, installs } from "../db/schema.js";
import { sql, eq, and, desc, gte, inArray } from "drizzle-orm";
import type { ActivityResponse, DownloadPruneResult, StatsResponse } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_WINDOW_DAYS = 30;
/** 이 기간 안에 업데이트 확인을 보낸 설치본을 "활성"으로 본다. */
const ACTIVE_INSTALL_DAYS = 14;
/** 활성 사용자 집계 기본 창(오늘 포함). 바꾸면 통계 화면의 설명 문구도 함께 고칠 것. */
export const ACTIVITY_WINDOW_DAYS = 30;
/** 활동 로그가 남은 PC 목록에서 표에 내려보낼 최대 행 수. */
export const ACTIVITY_MACHINE_LIMIT = 200;
/**
 * 다운로드 정리에서 허용하는 기준값 상한. 정리 도구가 "사실상 전체 삭제" 버튼이
 * 되지 않도록 막는 안전장치다. 바꾸면 통계 화면의 정리 팝업 문구도 함께 고칠 것.
 */
export const DOWNLOAD_PRUNE_MAX_THRESHOLD = 100;

/** 활동 로그의 날짜 키. 기존 일별 집계(`date(…, 'unixepoch')`)와 같은 UTC 기준. */
function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** `days`일 전(오늘 포함)의 날짜 키 — `dayKey(now)`가 1일째다. */
function cutoffDay(days: number): string {
  return dayKey(new Date(Date.now() - (days - 1) * DAY_MS));
}

interface RecordDownloadParams {
  version: string;
  platform: string;
  channel: string;
  arch?: string | undefined;
  releaseId?: string | undefined;
  artifactId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  machineId?: string | undefined;
}

/** 다운로드 기록 (같은 PC + 같은 버전이면 중복 카운트하지 않음). */
export function recordDownload(params: RecordDownloadParams): void {
  if (params.machineId) {
    const existing = db
      .select({ id: downloads.id })
      .from(downloads)
      .where(
        and(eq(downloads.version, params.version), eq(downloads.machineId, params.machineId)),
      )
      .get();
    if (existing) return;
  }

  db.insert(downloads)
    .values({
      version: params.version,
      platform: params.platform,
      channel: params.channel,
      arch: params.arch ?? null,
      releaseId: params.releaseId ?? null,
      artifactId: params.artifactId ?? null,
      ip: params.ip || null,
      userAgent: params.userAgent || null,
      machineId: params.machineId || null,
    })
    .run();
}

interface RecordCheckParams {
  machineId: string;
  version: string;
  channel: string;
  platform: string;
  arch?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * 업데이트 확인 핑을 기록한다. 두 곳에 남긴다:
 *
 * - `installs` — machineId당 1행(덮어쓰기). "지금 어떤 버전이 돌고 있나"의 스냅샷.
 * - `check_log` — (날짜 × machineId)당 1행(영구). "언제 살아 있었나"의 시간축.
 *
 * 스냅샷만으로는 활성 사용자 추이를 낼 수 없고(과거가 덮여 사라진다), 로그만으로는
 * 현재 버전 분포를 뽑기 번거로워 둘 다 남긴다.
 */
export function recordCheck(params: RecordCheckParams): void {
  const now = new Date();

  db.insert(checkLog)
    .values({
      day: dayKey(now),
      machineId: params.machineId,
      version: params.version,
      channel: params.channel,
      platform: params.platform,
      arch: params.arch ?? null,
      checks: 1,
      firstAt: now,
      lastAt: now,
    })
    .onConflictDoUpdate({
      target: [checkLog.day, checkLog.machineId],
      set: {
        // 하루 안에 업데이트가 끝나면 버전이 바뀐다 — 그날 마지막 값을 남긴다.
        version: params.version,
        channel: params.channel,
        platform: params.platform,
        arch: params.arch ?? null,
        lastAt: now,
        checks: sql`${checkLog.checks} + 1`,
      },
    })
    .run();

  db.insert(installs)
    .values({
      machineId: params.machineId,
      version: params.version,
      channel: params.channel,
      platform: params.platform,
      arch: params.arch ?? null,
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      checkCount: 1,
    })
    .onConflictDoUpdate({
      target: installs.machineId,
      set: {
        version: params.version,
        channel: params.channel,
        platform: params.platform,
        arch: params.arch ?? null,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        lastSeenAt: now,
        checkCount: sql`${installs.checkCount} + 1`,
      },
    })
    .run();
}

// ─── 활성 사용자 (check_log 기반) ────────────────────────────────────────────

/** 최근 `days`일(오늘 포함) 안에 한 번이라도 확인을 보낸 고유 PC 수. */
function activeUsersWithin(days: number): number {
  return (
    db
      .select({ count: sql<number>`count(distinct ${checkLog.machineId})` })
      .from(checkLog)
      .where(gte(checkLog.day, cutoffDay(days)))
      .get()?.count ?? 0
  );
}

function activeUserStats() {
  const allTime =
    db
      .select({ count: sql<number>`count(distinct ${checkLog.machineId})` })
      .from(checkLog)
      .get()?.count ?? 0;

  return {
    today: activeUsersWithin(1),
    last7Days: activeUsersWithin(7),
    last30Days: activeUsersWithin(ACTIVITY_WINDOW_DAYS),
    allTime,
  };
}

function dailyActiveUsers(): { date: string; count: number }[] {
  const rows = db
    .select({ date: checkLog.day, count: sql<number>`count(distinct ${checkLog.machineId})` })
    .from(checkLog)
    .where(gte(checkLog.day, cutoffDay(DAILY_WINDOW_DAYS)))
    .groupBy(checkLog.day)
    .orderBy(checkLog.day)
    .all();
  return fillMissingDays(rows);
}

/**
 * 활성 PC를 **현재 버전**(`installs`) 기준으로 센다. 로그의 버전으로 세면 기간 중
 * 업데이트한 PC가 옛 버전과 새 버전 양쪽에 잡혀 합계가 활성 대수를 넘는다.
 */
function activeByVersion(): { version: string; count: number }[] {
  return db
    .select({ version: installs.version, count: sql<number>`count(*)` })
    .from(installs)
    .where(
      sql`${installs.machineId} in (select machine_id from check_log where day >= ${cutoffDay(ACTIVITY_WINDOW_DAYS)})`,
    )
    .groupBy(installs.version)
    .orderBy(desc(sql`count(*)`))
    .all();
}

/**
 * 활동 로그가 남은 PC 목록 — 최근 확인 순. "활성 사용자 N명"이 어떤 PC들인지
 * 실제로 열어 볼 수 있어야 수치를 믿을 수 있다.
 */
export function getActivity(limit = ACTIVITY_MACHINE_LIMIT): ActivityResponse {
  const since = cutoffDay(ACTIVITY_WINDOW_DAYS);

  // PC마다 로그를 다시 훑는 상관 서브쿼리 대신 group by 한 번 + 조인.
  // 타임스탬프는 초 단위 정수로 그대로 나오므로 여기서 ISO로 바꾼다.
  const rows = db.all<{
    machineId: string;
    version: string;
    channel: string;
    platform: string;
    arch: string | null;
    firstSeenAt: number;
    lastSeenAt: number;
    checkCount: number;
    activeDays: number;
    totalDays: number;
  }>(sql`
    select i.machine_id as machineId, i.version as version, i.channel as channel,
           i.platform as platform, i.arch as arch,
           i.first_seen_at as firstSeenAt, i.last_seen_at as lastSeenAt,
           i.check_count as checkCount,
           coalesce(c.active_days, 0) as activeDays,
           coalesce(c.total_days, 0) as totalDays
      from installs i
      left join (
        select machine_id,
               count(*) as total_days,
               sum(case when day >= ${since} then 1 else 0 end) as active_days
          from check_log
         group by machine_id
      ) c on c.machine_id = i.machine_id
     order by i.last_seen_at desc
     limit ${limit}
  `);

  const totalMachines = db.select({ count: sql<number>`count(*)` }).from(installs).get()?.count ?? 0;

  return {
    windowDays: ACTIVITY_WINDOW_DAYS,
    limit,
    totalMachines,
    machines: rows.map((m) => ({
      machineId: m.machineId,
      version: m.version,
      channel: m.channel,
      platform: m.platform,
      arch: m.arch,
      firstSeenAt: new Date(m.firstSeenAt * 1000).toISOString(),
      lastSeenAt: new Date(m.lastSeenAt * 1000).toISOString(),
      checkCount: m.checkCount,
      activeDays: m.activeDays,
      totalDays: m.totalDays,
    })),
  };
}

function countSince(days: number): number {
  const cutoff = Math.floor((Date.now() - days * DAY_MS) / 1000);
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(downloads)
      .where(sql`downloaded_at >= ${cutoff}`)
      .get()?.count ?? 0
  );
}

export function getStats(): StatsResponse {
  const total = db.select({ count: sql<number>`count(*)` }).from(downloads).get()?.count ?? 0;

  const uniqueMachines =
    db
      .select({ count: sql<number>`count(distinct machine_id)` })
      .from(downloads)
      .where(sql`machine_id is not null`)
      .get()?.count ?? 0;

  const byVersion = db
    .select({ version: downloads.version, count: sql<number>`count(*)` })
    .from(downloads)
    .groupBy(downloads.version)
    .orderBy(desc(sql`count(*)`))
    .all();

  const byPlatform = db
    .select({ platform: downloads.platform, count: sql<number>`count(*)` })
    .from(downloads)
    .groupBy(downloads.platform)
    .orderBy(desc(sql`count(*)`))
    .all();

  const byChannel = db
    .select({ channel: downloads.channel, count: sql<number>`count(*)` })
    .from(downloads)
    .groupBy(downloads.channel)
    .orderBy(desc(sql`count(*)`))
    .all();

  const dailyCutoff = Math.floor((Date.now() - DAILY_WINDOW_DAYS * DAY_MS) / 1000);
  const daily = db
    .select({
      date: sql<string>`date(downloaded_at, 'unixepoch')`,
      count: sql<number>`count(*)`,
    })
    .from(downloads)
    .where(sql`downloaded_at >= ${dailyCutoff}`)
    .groupBy(sql`date(downloaded_at, 'unixepoch')`)
    .orderBy(sql`date(downloaded_at, 'unixepoch')`)
    .all();

  const installsByVersion = db
    .select({ version: installs.version, count: sql<number>`count(*)` })
    .from(installs)
    .groupBy(installs.version)
    .orderBy(desc(sql`count(*)`))
    .all();

  const activeCutoff = Math.floor((Date.now() - ACTIVE_INSTALL_DAYS * DAY_MS) / 1000);
  const activeInstalls =
    db
      .select({ count: sql<number>`count(*)` })
      .from(installs)
      .where(sql`last_seen_at >= ${activeCutoff}`)
      .get()?.count ?? 0;

  return {
    total,
    uniqueMachines,
    last7Days: countSince(7),
    last30Days: countSince(30),
    byVersion,
    byPlatform,
    byChannel,
    daily: fillMissingDays(daily),
    installsByVersion,
    activeInstalls,
    activeUsers: activeUserStats(),
    dailyActiveUsers: dailyActiveUsers(),
    activeByVersion: activeByVersion(),
  };
}

/**
 * 다운로드 수가 `maxCount` 이하인 버전의 기록을 지운다.
 *
 * 실사용자가 적은 동안에는 개발자가 직접 눌러 본 한두 건이 버전 목록을 가득 채워
 * 정작 사용자가 받은 버전이 묻힌다. 버전 단위로만 지우는 이유는 기준이 눈에 보이는
 * 집계와 정확히 일치해야(= 화면의 "버전별 다운로드" 막대) 무엇이 사라지는지 미리
 * 확인할 수 있기 때문이다.
 *
 * `installs`·`check_log`는 건드리지 않는다 — 활성 사용자 집계의 시간축이고, 다운로드
 * 기록과 달리 지우면 복구할 방법이 없다.
 */
export function pruneDownloadsByVersion(maxCount: number): DownloadPruneResult {
  const victims = db
    .select({ version: downloads.version, count: sql<number>`count(*)` })
    .from(downloads)
    .groupBy(downloads.version)
    .having(sql`count(*) <= ${maxCount}`)
    .orderBy(desc(sql`count(*)`))
    .all();

  if (victims.length === 0) return { versions: [], deletedRows: 0 };

  db.delete(downloads)
    .where(
      inArray(
        downloads.version,
        victims.map((v) => v.version),
      ),
    )
    .run();

  return {
    versions: victims,
    deletedRows: victims.reduce((sum, v) => sum + v.count, 0),
  };
}

/**
 * 비어 있는 날짜를 0으로 메운다. 구 대시보드는 기록이 있는 날만 막대를 그려
 * 하루 1건씩 띄엄띄엄 있는 구간이 매일 꾸준한 것처럼 보였다.
 */
function fillMissingDays(rows: { date: string; count: number }[]): { date: string; count: number }[] {
  const byDate = new Map(rows.map((r) => [r.date, r.count]));
  const out: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = DAILY_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDate.get(key) ?? 0 });
  }
  return out;
}
