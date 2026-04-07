import { Hono } from "hono";
import { getLatestRelease } from "../services/github.js";
import { recordDownload } from "../services/stats.js";
import type { Platform } from "../types.js";

const VALID_PLATFORMS: Platform[] = ["windows"];

export const updateRouter = new Hono();

/**
 * GET /update/check?platform=windows&version=0.5.1
 * 클라이언트가 업데이트 필요 여부를 확인
 */
updateRouter.get("/check", async (c) => {
  const platform = c.req.query("platform") as Platform | undefined;
  const currentVersion = c.req.query("version")?.replace(/^v/, "");

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return c.json({ error: "Invalid platform" }, 400);
  }
  if (!currentVersion) {
    return c.json({ error: "Missing version parameter" }, 400);
  }

  try {
    const latest = await getLatestRelease();
    const asset = latest.assets[platform];
    const updateAvailable =
      !!asset && compareVersions(latest.version, currentVersion) > 0;

    return c.json({
      updateAvailable,
      latest: {
        version: latest.version,
        name: latest.name,
        notes: latest.notes,
        publishedAt: latest.publishedAt,
        downloadUrl: asset
          ? `/update/download/${platform}`
          : null,
        fileSize: asset?.size ?? null,
      },
    });
  } catch (e) {
    console.error("Failed to check update:", e);
    return c.json({ error: "Failed to fetch release info" }, 502);
  }
});

/**
 * GET /update/download/:platform
 * GitHub 에셋 URL로 리다이렉트 + 다운로드 카운트
 */
updateRouter.get("/download/:platform", async (c) => {
  const platform = c.req.param("platform") as Platform;

  if (!VALID_PLATFORMS.includes(platform)) {
    return c.json({ error: "Invalid platform" }, 400);
  }

  try {
    const latest = await getLatestRelease();
    const asset = latest.assets[platform];

    if (!asset) {
      return c.json({ error: "No asset found for this platform" }, 404);
    }

    recordDownload({
      version: latest.version,
      platform,
      ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
    });

    return c.redirect(asset.url, 302);
  } catch (e) {
    console.error("Failed to serve download:", e);
    return c.json({ error: "Failed to fetch release info" }, 502);
  }
});

/** 시맨틱 버전 비교: a > b → 양수, a < b → 음수, a == b → 0 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}
