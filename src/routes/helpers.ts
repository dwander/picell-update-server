import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { ReleaseError } from "../services/releases.js";
import { SESSION_COOKIE, isAuthConfigured, validateSession } from "../services/auth.js";

/** 관리 API 공용 에러 변환 — 도메인 에러는 상태코드를 살리고, 나머지는 500. */
export async function handle<T>(c: Context, fn: () => T | Promise<T>): Promise<Response> {
  try {
    return c.json((await fn()) as object);
  } catch (e) {
    if (e instanceof ReleaseError) {
      return c.json({ error: e.message }, e.status as 400);
    }
    console.error("[admin]", e);
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    return c.json({ error: message }, 500);
  }
}

export function clientIp(c: Context): string | undefined {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip");
}

/** 세션 쿠키 검사. ADMIN_PASSWORD 미설정이면 콘솔 전체를 잠근다. */
export async function requireAuth(c: Context, next: () => Promise<void>): Promise<Response | void> {
  if (!isAuthConfigured()) {
    return c.json({ error: "ADMIN_PASSWORD가 설정되지 않아 관리 콘솔이 비활성화되어 있습니다." }, 503);
  }
  if (!validateSession(getCookie(c, SESSION_COOKIE))) {
    return c.json({ error: "인증이 필요합니다." }, 401);
  }
  await next();
}

export async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new ReleaseError("요청 본문이 올바른 JSON이 아닙니다.");
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ReleaseError(`${field} 값이 필요합니다.`);
  }
  return value.trim();
}
