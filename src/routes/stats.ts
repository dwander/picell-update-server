import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import {
  getTotalDownloads,
  getDownloadsByVersion,
  getDownloadsByPlatform,
  getDailyDownloads,
} from "../services/stats.js";

export const statsRouter = new Hono();

const STATS_PASSWORD = process.env.STATS_PASSWORD;

/** 통계 엔드포인트 접근 제한 */
if (STATS_PASSWORD) {
  statsRouter.use("/stats", basicAuth({ username: "admin", password: STATS_PASSWORD }));
  statsRouter.use("/api/stats", basicAuth({ username: "admin", password: STATS_PASSWORD }));
} else {
  statsRouter.use("/stats", async (c) => c.text("STATS_PASSWORD not configured", 403));
  statsRouter.use("/api/stats", async (c) => c.text("STATS_PASSWORD not configured", 403));
}

/** GET /api/stats — 통계 JSON */
statsRouter.get("/api/stats", (c) => {
  return c.json({
    total: getTotalDownloads(),
    byVersion: getDownloadsByVersion(),
    byPlatform: getDownloadsByPlatform(),
    daily: getDailyDownloads(),
  });
});

/** GET /stats — 통계 대시보드 HTML */
statsRouter.get("/stats", (c) => {
  const total = getTotalDownloads();
  const byVersion = getDownloadsByVersion();
  const byPlatform = getDownloadsByPlatform();
  const daily = getDailyDownloads();

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PiCell Update Stats</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0d1117;
      color: #e6edf3;
      padding: 2rem;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #58a6ff; }
    h2 { font-size: 1.1rem; margin-bottom: 0.75rem; color: #8b949e; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem; }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.25rem;
    }
    .big-number { font-size: 2.5rem; font-weight: 700; color: #58a6ff; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 600; }
    .bar-container { display: flex; align-items: center; gap: 0.5rem; }
    .bar {
      height: 8px;
      background: #58a6ff;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .chart { margin-bottom: 2rem; }
    .chart-bars { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
    .chart-bar {
      flex: 1;
      background: #58a6ff;
      border-radius: 2px 2px 0 0;
      min-width: 4px;
      position: relative;
    }
    .chart-bar:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: #30363d;
      color: #e6edf3;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      white-space: nowrap;
    }
    .refresh { color: #8b949e; font-size: 0.85rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>PiCell Update Server — Stats</h1>

  <div class="grid">
    <div class="card">
      <h2>Total Downloads</h2>
      <div class="big-number">${total.toLocaleString()}</div>
    </div>
    <div class="card">
      <h2>Versions</h2>
      <div class="big-number">${byVersion.length}</div>
    </div>
  </div>

  ${daily.length > 0 ? `
  <div class="card chart">
    <h2>Daily Downloads (Last 30 Days)</h2>
    <div class="chart-bars">
      ${(() => {
        const max = Math.max(...daily.map((d) => d.count), 1);
        return daily
          .map(
            (d) =>
              `<div class="chart-bar" style="height: ${(d.count / max) * 100}%" data-tooltip="${d.date}: ${d.count}"></div>`
          )
          .join("");
      })()}
    </div>
  </div>
  ` : ""}

  <div class="grid">
    <div class="card">
      <h2>By Version</h2>
      <table>
        <tr><th>Version</th><th>Downloads</th></tr>
        ${byVersion
          .map((v) => {
            const maxCount = byVersion[0]?.count ?? 1;
            const pct = (v.count / maxCount) * 100;
            return `<tr>
              <td>${v.version}</td>
              <td>
                <div class="bar-container">
                  <div class="bar" style="width: ${pct}%; min-width: 4px;"></div>
                  ${v.count}
                </div>
              </td>
            </tr>`;
          })
          .join("")}
      </table>
    </div>
    <div class="card">
      <h2>By Platform</h2>
      <table>
        <tr><th>Platform</th><th>Downloads</th></tr>
        ${byPlatform
          .map(
            (p) => `<tr><td>${p.platform}</td><td>${p.count}</td></tr>`
          )
          .join("")}
      </table>
    </div>
  </div>

  <p class="refresh">Auto-refreshes every 60 seconds</p>
  <script>setTimeout(() => location.reload(), 60000);</script>
</body>
</html>`;

  return c.html(html);
});
