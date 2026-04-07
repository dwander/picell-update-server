import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { updateRouter } from "./routes/update.js";
import { statsRouter } from "./routes/stats.js";
import { db } from "./db/index.js";
import { sql } from "drizzle-orm";

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
      downloaded_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

const PORT = Number(process.env.PORT) || 3000;

initDb();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`PiCell Update Server running on http://localhost:${info.port}`);
});
