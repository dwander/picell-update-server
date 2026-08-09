import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { ReleaseError } from "../services/releases.js";
import { SESSION_COOKIE, isAuthConfigured, validateSession } from "../services/auth.js";
import { storageErrorMessage } from "../services/storage.js";

/** 관리 API 공용 에러 변환 — 도메인 에러는 상태코드를 살리고, 나머지는 500. */
export async function handle<T>(c: Context, fn: () => T | Promise<T>): Promise<Response> {
  try {
    return c.json((await fn()) as object);
  } catch (e) {
    if (e instanceof ReleaseError) {
      return c.json({ error: e.message }, e.status as 400);
    }
    // R2 설정 오류는 SDK 스택 대신 고칠 수 있는 문장으로 돌려준다.
    const storageMessage = storageErrorMessage(e);
    if (storageMessage) {
      console.error("[admin] storage:", (e as { name?: string })?.name);
      return c.json({ error: storageMessage }, 502);
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

/**
 * JSON 본문의 정수 필드. `Number()`로 먼저 바꾸지 않고 타입부터 보는 이유는
 * `null`·`""`·`[]`가 모두 0으로 둔갑해, 값을 빼먹은 요청이 "0으로 맞춰라"가 되기 때문이다.
 */
export function requireInteger(
  value: unknown,
  field: string,
  range: { min: number; max: number },
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < range.min ||
    value > range.max
  ) {
    throw new ReleaseError(`${field}는 ${range.min} 이상 ${range.max} 이하의 정수여야 합니다.`);
  }
  return value;
}
