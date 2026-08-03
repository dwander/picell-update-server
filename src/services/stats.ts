import { db } from "../db/index.js";
import { downloads, installs } from "../db/schema.js";
import { sql, eq, and, desc } from "drizzle-orm";
import type { StatsResponse } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_WINDOW_DAYS = 30;
/** 이 기간 안에 업데이트 확인을 보낸 설치본을 "활성"으로 본다. */
const ACTIVE_INSTALL_DAYS = 14;

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
 * 업데이트 확인 핑을 설치 현황으로 누적한다. machineId당 1행만 유지하므로
 * 테이블이 무한히 커지지 않으면서 "어떤 버전이 실제로 돌고 있는지"를 알 수 있다
 * (다운로드 수만으로는 설치 후 롤백·재설치를 구분할 수 없다).
 */
export function recordCheck(params: RecordCheckParams): void {
  const now = new Date();
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
