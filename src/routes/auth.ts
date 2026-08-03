import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  isAuthConfigured,
  validateSession,
  verifyPassword,
} from "../services/auth.js";
import { logAction } from "../services/audit.js";
import { clientIp, readJson } from "./helpers.js";
import { boolEnv, optionalEnv } from "../env.js";
import type { Context } from "hono";

/**
 * Secure 쿠키 여부를 **요청 프로토콜로** 판단한다.
 * NODE_ENV에 의존하면 Railway처럼 그 변수를 안 넣는 환경에서 https인데도 Secure가
 * 빠진다. 프록시 뒤라 실제 프로토콜은 x-forwarded-proto에 있다.
 * SECURE_COOKIE 환경변수로 강제 지정도 가능하다(로컬 https 테스트 등).
 */
function useSecureCookie(c: Context): boolean {
  const forced = optionalEnv("SECURE_COOKIE");
  if (forced !== undefined) return boolEnv("SECURE_COOKIE");
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  if (proto) return proto === "https";
  return new URL(c.req.url).protocol === "https:";
}

export const authRouter = new Hono();

/** GET /admin/api/session — 콘솔 부팅 시 로그인 상태·서버 설정 확인. */
authRouter.get("/session", (c) => {
  return c.json({
    authenticated: validateSession(getCookie(c, SESSION_COOKIE)),
    authConfigured: isAuthConfigured(),
  });
});

authRouter.post("/login", async (c) => {
  if (!isAuthConfigured()) {
    return c.json({ error: "ADMIN_PASSWORD가 설정되지 않았습니다." }, 503);
  }
  const body = await readJson<{ password?: string }>(c);
  if (!body.password || !verifyPassword(body.password)) {
    logAction("login.failed", null, null, clientIp(c));
    return c.json({ error: "비밀번호가 올바르지 않습니다." }, 401);
  }

  const { token, maxAge } = createSession(clientIp(c), c.req.header("user-agent"));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: useSecureCookie(c),
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
  logAction("login.success", null, null, clientIp(c));
  return c.json({ authenticated: true });
});

authRouter.post("/logout", (c) => {
  destroySession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ authenticated: false });
});
