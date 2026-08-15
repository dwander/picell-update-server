import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { updateRouter } from "./routes/update.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin/index.js";
import { legacyRouter } from "./routes/legacy.js";
import { migrate } from "./db/migrate.js";
import { PORT, PUBLIC_DIR } from "./env.js";
import { isStorageConfigured, bucketName } from "./services/storage.js";
import { isAuthConfigured } from "./services/auth.js";

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = new Hono();

app.use("*", logger());

// 클라이언트 공개 API
//
// 브라우저에서도 읽을 수 있어야 한다 — 소개/다운로드 사이트가 `/update/latest`와
// `/update/changelog`를 fetch 로 가져와 버전과 릴리즈 노트를 표시한다. 여기 있는 것은
// 전부 **공개 읽기 전용** 정보이고 쿠키·인증을 쓰지 않으므로 origin 을 열어 둔다.
// 관리 콘솔 API(`/admin/api`)에는 붙이지 않는다.
app.use("/update/*", cors({ origin: "*", allowMethods: ["GET", "HEAD", "OPTIONS"] }));
app.route("/update", updateRouter);

// 관리 콘솔 API — 로그인 라우터가 인증 미들웨어보다 먼저 걸려야 한다.
app.route("/admin/api", authRouter);
app.route("/admin/api", adminRouter);

// 구 경로 호환
app.route("/", legacyRouter);

app.get("/healthz", (c) =>
  c.json({
    status: "ok",
    service: "picell-update-server",
    storage: isStorageConfigured() ? bucketName() : null,
  }),
);

// ─── 관리 콘솔 SPA ───────────────────────────────────────────────────────────
// vite 산출물을 그대로 서빙한다. 해시 파일명 자산은 영구 캐시, index.html은 무캐시
// (배포 직후 옛 셸이 사라진 자산을 참조하는 사고 방지).

const indexHtmlPath = join(PUBLIC_DIR, "index.html");
const hasBuiltSpa = existsSync(indexHtmlPath);

app.use(
  "/assets/*",
  serveStatic({
    root: PUBLIC_DIR,
    onFound: (_path, c) => {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);
app.get("/favicon.svg", serveStatic({ root: PUBLIC_DIR }));

/** /admin 이하 모든 경로는 SPA 셸로 (클라이언트 라우터가 처리). */
app.get("/admin/*", async (c) => {
  if (!hasBuiltSpa) {
    return c.text("관리 콘솔이 빌드되지 않았습니다. `npm run build:web`을 실행하세요.", 503);
  }
  c.header("Cache-Control", "no-store");
  return c.html(await readFile(indexHtmlPath, "utf8"));
});

// 루트는 **200으로 응답해야 한다.** 구 배포의 Railway 헬스체크 경로가 `/`였고,
// 헬스체크는 2xx만 통과시킨다 — 여기서 302를 내면 새 배포가 헬스체크에 걸려
// 올라가지 못하고 구버전이 계속 서빙된다. railway.json이 /healthz를 지정하지만
// 대시보드 설정이 남아 있을 수 있어 루트도 안전하게 2xx로 둔다.
// 브라우저는 meta refresh로 콘솔까지 데려간다.
app.get("/", (c) =>
  c.html(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8">` +
      `<meta http-equiv="refresh" content="0; url=/admin">` +
      `<title>PiCell Update Server</title></head>` +
      `<body><a href="/admin">관리 콘솔로 이동</a></body></html>`,
  ),
);

migrate();

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`PiCell Update Server → http://localhost:${info.port}`);
  console.log(
    `  관리 콘솔: /admin ${isAuthConfigured() ? "" : "(ADMIN_PASSWORD 미설정 — 비활성)"}`,
  );
  console.log(
    `  스토리지: ${isStorageConfigured() ? bucketName() : "미설정 (STORAGE_* 환경변수 필요)"}`,
  );
});

function shutdown(signal: string): void {
  console.log(`[${signal}] graceful shutdown`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
