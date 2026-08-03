// 구 버전 호환 경로. 새 콘솔은 /admin 아래 세션 인증을 쓰지만, 예전에 Basic Auth로
// 열어두던 /stats·/api/stats를 참조하는 북마크·스크립트가 있을 수 있어 유지한다.

import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { getStats } from "../services/stats.js";
import { adminPassword } from "../env.js";

export const legacyRouter = new Hono();

const password = adminPassword();

if (password) {
  legacyRouter.use("/api/stats", basicAuth({ username: "admin", password }));
  legacyRouter.get("/api/stats", (c) => c.json(getStats()));
} else {
  legacyRouter.get("/api/stats", (c) => c.text("ADMIN_PASSWORD not configured", 403));
}

/** 구 HTML 대시보드는 새 콘솔로 대체됐다. */
legacyRouter.get("/stats", (c) => c.redirect("/admin/stats", 302));
