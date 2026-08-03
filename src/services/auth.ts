// 관리 콘솔 인증. 단일 관리자용이라 계정 테이블 없이 ADMIN_PASSWORD 하나로
// 로그인하고, 세션 토큰을 httpOnly 쿠키로 발급한다.
//
// 구 방식(Basic Auth)에서 옮긴 이유: 브라우저 SPA에서 Basic Auth는 로그아웃이
// 불가능하고, 모든 XHR에 자격증명이 실려 나간다. 토큰은 해시로만 저장해 DB가
// 새더라도 세션을 탈취당하지 않는다.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { adminPassword } from "../env.js";

export const SESSION_COOKIE = "picell_admin";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일
const TOKEN_BYTES = 32;

export function isAuthConfigured(): boolean {
  return Boolean(adminPassword());
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 길이 노출·타이밍 차이를 줄이려 해시끼리 상수시간 비교한다. */
export function verifyPassword(input: string): boolean {
  const expected = adminPassword();
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function createSession(ip?: string, userAgent?: string): { token: string; maxAge: number } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.insert(sessions)
    .values({
      tokenHash: hashToken(token),
      createdAt: new Date(),
      expiresAt,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    })
    .run();
  purgeExpiredSessions();
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
  if (!row) return false;
  if (row.expiresAt.getTime() < Date.now()) {
    db.delete(sessions).where(eq(sessions.tokenHash, row.tokenHash)).run();
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function purgeExpiredSessions(): void {
  db.delete(sessions).where(sql`expires_at < ${Math.floor(Date.now() / 1000)}`).run();
}
