import { Hono } from "hono";
import { getLatestRelease, getLatestBetaRelease, compareVersions } from "../services/github.js";
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
  const channel = c.req.query("channel") === "beta" ? "beta" : "stable";

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return c.json({ error: "Invalid platform" }, 400);
  }
  if (!currentVersion) {
    return c.json({ error: "Missing version parameter" }, 400);
  }

  try {
    const latest =
      channel === "beta"
        ? await getLatestBetaRelease()
        : await getLatestRelease();

    if (!latest) {
      return c.json({ error: "No beta release found" }, 404);
    }

    const asset = latest.assets[platform];
    const updateAvailable =
      !!asset && compareVersions(latest.version, currentVersion) > 0;

    return c.json({
      updateAvailable,
      channel,
      latest: {
        version: latest.version,
        name: latest.name,
        notes: latest.notes,
        publishedAt: latest.publishedAt,
        prerelease: latest.prerelease,
        downloadUrl: asset ? `/update/download/${platform}?channel=${channel}` : null,
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
  const channel = c.req.query("channel") === "beta" ? "beta" : "stable";

  if (!VALID_PLATFORMS.includes(platform)) {
    return c.json({ error: "Invalid platform" }, 400);
  }

  try {
    const latest =
      channel === "beta"
        ? await getLatestBetaRelease()
        : await getLatestRelease();

    if (!latest) {
      return c.json({ error: "No beta release found" }, 404);
    }

    const asset = latest.assets[platform];

    if (!asset) {
      return c.json({ error: "No asset found for this platform" }, 404);
    }

    recordDownload({
      version: latest.version,
      platform,
      ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
      userAgent: c.req.header("user-agent"),
      machineId: c.req.query("machineId"),
    });

    return c.redirect(asset.url, 302);
  } catch (e) {
    console.error("Failed to serve download:", e);
    return c.json({ error: "Failed to fetch release info" }, 502);
  }
});

