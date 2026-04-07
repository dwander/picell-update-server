import { db } from "../db/index.js";
import { downloads } from "../db/schema.js";
import { sql, eq, and, desc } from "drizzle-orm";

interface RecordDownloadParams {
  version: string;
  platform: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  machineId?: string | undefined;
}

/** 다운로드 기록 저장 (같은 PC + 같은 버전이면 중복 카운트하지 않음) */
export function recordDownload(params: RecordDownloadParams): void {
  if (params.machineId) {
    const existing = db
      .select({ id: downloads.id })
      .from(downloads)
      .where(
        and(
          eq(downloads.version, params.version),
          eq(downloads.machineId, params.machineId)
        )
      )
      .get();

    if (existing) return;
  }

  db.insert(downloads)
    .values({
      version: params.version,
      platform: params.platform,
      ip: params.ip || null,
      userAgent: params.userAgent || null,
      machineId: params.machineId || null,
    })
    .run();
}

/** 전체 다운로드 수 */
export function getTotalDownloads(): number {
  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(downloads)
    .get();
  return result?.count ?? 0;
}

/** 버전별 다운로드 수 */
export function getDownloadsByVersion(): { version: string; count: number }[] {
  return db
    .select({
      version: downloads.version,
      count: sql<number>`count(*)`,
    })
    .from(downloads)
    .groupBy(downloads.version)
    .orderBy(desc(sql`count(*)`))
    .all();
}

/** 플랫폼별 다운로드 수 */
export function getDownloadsByPlatform(): {
  platform: string;
  count: number;
}[] {
  return db
    .select({
      platform: downloads.platform,
      count: sql<number>`count(*)`,
    })
    .from(downloads)
    .groupBy(downloads.platform)
    .orderBy(desc(sql`count(*)`))
    .all();
}

/** 일별 다운로드 수 (최근 30일) */
export function getDailyDownloads(): { date: string; count: number }[] {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return db
    .select({
      date: sql<string>`date(downloaded_at, 'unixepoch')`,
      count: sql<number>`count(*)`,
    })
    .from(downloads)
    .where(sql`downloaded_at >= ${Math.floor(thirtyDaysAgo.getTime() / 1000)}`)
    .groupBy(sql`date(downloaded_at, 'unixepoch')`)
    .orderBy(sql`date(downloaded_at, 'unixepoch')`)
    .all();
}
