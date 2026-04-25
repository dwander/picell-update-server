import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { updateRouter } from "./routes/update.js";
import { statsRouter } from "./routes/stats.js";
import { db } from "./db/index.js";
import { sql } from "drizzle-orm";

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

const app = new Hono();

// 미들웨어
app.use("*", logger());

// 라우트
app.route("/update", updateRouter);
app.route("/", statsRouter);

// 헬스체크
app.get("/", (c) => {
  return c.json({ status: "ok", service: "picell-update-server" });
});

// DB 테이블 자동 생성
function initDb(): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      platform TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      machine_id TEXT,
      downloaded_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  // 기존 테이블에 machine_id 컬럼이 없으면 추가
  try {
    db.run(sql`ALTER TABLE downloads ADD COLUMN machine_id TEXT`);
  } catch {
    // 이미 컬럼이 존재하면 무시
  }
}

const PORT = Number(process.env.PORT) || 3000;

initDb();

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`PiCell Update Server running on http://localhost:${info.port}`);
});

function shutdown(signal: string): void {
  console.log(`[${signal}] graceful shutdown`);
  server.close(() => process.exit(0));
  // 강제 종료 fallback (10초 후)
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
