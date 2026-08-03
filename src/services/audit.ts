// 관리 작업 감사 로그. 릴리즈 발행·철회·삭제처럼 되돌리기 어려운 조작이 언제
// 무엇에 일어났는지 남긴다 — 배포 사고 원인 추적의 최소 장치.

import { db } from "../db/index.js";
import { auditLogs } from "../db/schema.js";
import { desc, sql } from "drizzle-orm";

const RETENTION_ROWS = 2000;

export function logAction(
  action: string,
  target?: string | null,
  detail?: unknown,
  ip?: string | null,
): void {
  db.insert(auditLogs)
    .values({
      action,
      target: target ?? null,
      detail: detail === undefined ? null : JSON.stringify(detail),
      ip: ip ?? null,
    })
    .run();
}

export function listAuditLogs(limit = 100) {
  return db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      action: r.action,
      target: r.target,
      detail: r.detail,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    }));
}

/** 오래된 로그를 잘라 SQLite 파일이 무한정 커지지 않게 한다. */
export function trimAuditLogs(): void {
  db.run(
    sql`DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT ${RETENTION_ROWS})`,
  );
}
