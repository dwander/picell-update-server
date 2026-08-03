// 데스크톱 앱이 호출하는 공개 API. **구 계약을 그대로 유지한다** — 이미 배포된
// 클라이언트가 있으므로 `/update/check`, `/update/download/:platform`의 파라미터와
// 응답 필드는 유지하고, 새 정보(mandatory, sha256, items 등)는 추가만 한다.

import { Hono } from "hono";
import { getChangelog } from "../services/changelog.js";
import {
  listArtifacts,
  listPublishedRows,
  pickArtifact,
  resolveLatest,
} from "../services/releases.js";
import { recordCheck, recordDownload } from "../services/stats.js";
import { isInRollout } from "../services/rollout.js";
import { downloadUrlFor } from "../services/storage.js";
import { compareVersions, normalizeVersion } from "../version.js";
import {
  isArch,
  isChannel,
  isLocale,
  isPlatform,
  type Arch,
  type Channel,
  type ChangelogFeedEntry,
  type Locale,
  type Platform,
  type UpdateCheckResponse,
} from "../types.js";

const DEFAULT_PLATFORM: Platform = "windows";
const DEFAULT_ARCH: Arch = "x64";
const DEFAULT_LOCALE: Locale = "ko";
const CHANGELOG_FEED_LIMIT = 50;

export const updateRouter = new Hono();

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string | undefined {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip");
}

function readChannel(v: string | undefined): Channel {
  return isChannel(v) ? v : "stable";
}

function readArch(v: string | undefined): Arch {
  return isArch(v) ? v : DEFAULT_ARCH;
}

function readLocale(v: string | undefined): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/**
 * GET /update/check?platform=windows&version=1.0.0&channel=beta&arch=x64&machineId=…&locale=ko
 * 업데이트 가능 여부 + 릴리즈 노트.
 */
updateRouter.get("/check", (c) => {
  const platform = c.req.query("platform") ?? DEFAULT_PLATFORM;
  const currentVersion = normalizeVersion(c.req.query("version") ?? "");
  const channel = readChannel(c.req.query("channel"));
  const arch = readArch(c.req.query("arch"));
  const locale = readLocale(c.req.query("locale"));
  const machineId = c.req.query("machineId");

  if (!isPlatform(platform)) {
    return c.json({ error: "Invalid platform" }, 400);
  }
  if (!currentVersion) {
    return c.json({ error: "Missing version parameter" }, 400);
  }

  // 설치 현황 집계는 실패해도 업데이트 확인을 막지 않는다.
  if (machineId) {
    try {
      recordCheck({
        machineId,
        version: currentVersion,
        channel,
        platform,
        arch,
        ip: clientIp(c),
        userAgent: c.req.header("user-agent"),
      });
    } catch (e) {
      console.warn("[update/check] failed to record install ping:", e);
    }
  }

  const resolved = resolveLatest(channel, platform, arch);

  if (!resolved?.artifact) {
    const empty: UpdateCheckResponse = {
      updateAvailable: false,
      channel,
      mandatory: false,
      latest: null,
    };
    return c.json(empty);
  }

  const { release, artifact } = resolved;
  const newer = compareVersions(release.version, currentVersion) > 0;
  const inRollout = isInRollout(release.rolloutPercent, release.version, machineId);
  const changelog = getChangelog(release.id, locale);

  const mandatory =
    newer &&
    (release.mandatory ||
      (release.minSupportedVersion
        ? compareVersions(currentVersion, release.minSupportedVersion) < 0
        : false));

  // 단계적 배포에서 빠진 클라이언트에게도 릴리즈 정보 자체는 준다(`updateAvailable`만
  // false). 앱이 최신 상태를 정확히 표시할 수 있고, 강제 업데이트 대상이면 rollout과
  // 무관하게 내보낸다.
  const response: UpdateCheckResponse = {
    updateAvailable: newer && (inRollout || mandatory),
    channel,
    mandatory,
    latest: {
      version: release.version,
      name: release.name,
      notes: changelog.rendered,
      summary: changelog.summary,
      items: changelog.items.map((i) => ({ type: i.type, text: i.text })),
      publishedAt: release.publishedAt?.toISOString() ?? null,
      prerelease: release.channel === "beta",
      downloadUrl: `/update/download/${platform}?channel=${channel}&arch=${arch}`,
      fileName: artifact.fileName,
      fileSize: artifact.size,
      sha256: artifact.sha256,
    },
  };
  return c.json(response);
});

/**
 * GET /update/download/:platform?channel=&arch=&machineId=&version=
 * R2 오브젝트로 302. version을 주면 그 버전을 직접 받는다(구버전 재설치·롤백).
 */
updateRouter.get("/download/:platform", async (c) => {
  const platform = c.req.param("platform");
  const channel = readChannel(c.req.query("channel"));
  const arch = readArch(c.req.query("arch"));
  const machineId = c.req.query("machineId");
  const pinnedVersion = c.req.query("version");

  if (!isPlatform(platform)) {
    return c.json({ error: "Invalid platform" }, 400);
  }

  try {
    const resolved = pinnedVersion
      ? resolvePinned(pinnedVersion, platform, arch)
      : resolveLatest(channel, platform, arch);

    if (!resolved?.artifact) {
      return c.json({ error: "No asset found for this platform" }, 404);
    }
    const { release, artifact } = resolved;

    try {
      recordDownload({
        version: release.version,
        platform,
        channel,
        arch,
        releaseId: release.id,
        artifactId: artifact.id,
        ip: clientIp(c),
        userAgent: c.req.header("user-agent"),
        machineId,
      });
    } catch (e) {
      // 통계 실패로 다운로드를 막지 않는다.
      console.warn("[update/download] failed to record download:", e);
    }

    return c.redirect(await downloadUrlFor(artifact.storageKey, artifact.fileName), 302);
  } catch (e) {
    console.error("Failed to serve download:", e);
    return c.json({ error: "Failed to resolve download" }, 502);
  }
});

/** 특정 버전 고정 다운로드. 발행된 릴리즈만 대상(초안·철회본은 못 받는다). */
function resolvePinned(version: string, platform: Platform, arch: Arch) {
  const normalized = normalizeVersion(version);
  const release = listPublishedRows("beta").find((r) => r.version === normalized);
  if (!release) return null;
  return { release, artifact: pickArtifact(listArtifacts(release.id), platform, arch) };
}

/**
 * GET /update/changelog?channel=&locale=&since=1.0.0&limit=20
 * 발행된 릴리즈 노트 피드. `since`를 주면 그 버전보다 높은 것만 — 여러 버전을
 * 건너뛴 사용자에게 그동안의 변경점을 한 번에 보여주기 위한 것.
 */
updateRouter.get("/changelog", (c) => {
  const channel = readChannel(c.req.query("channel"));
  const locale = readLocale(c.req.query("locale"));
  const sinceParam = c.req.query("since");
  const since = sinceParam ? normalizeVersion(sinceParam) : null;
  const limit = Math.min(
    Number(c.req.query("limit")) || CHANGELOG_FEED_LIMIT,
    CHANGELOG_FEED_LIMIT,
  );

  const entries: ChangelogFeedEntry[] = listPublishedRows(channel)
    .filter((r) => (since ? compareVersions(r.version, since) > 0 : true))
    .slice(0, limit)
    .map((r) => {
      const changelog = getChangelog(r.id, locale);
      return {
        version: r.version,
        channel: r.channel as Channel,
        name: r.name,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        summary: changelog.summary,
        notes: changelog.rendered,
        items: changelog.items.map((i) => ({ type: i.type, text: i.text })),
      };
    });

  return c.json({ channel, locale, entries });
});

/** GET /update/latest?channel=&platform=&arch= — 다운로드 페이지·설치 스크립트용 요약. */
updateRouter.get("/latest", (c) => {
  const channel = readChannel(c.req.query("channel"));
  const platformParam = c.req.query("platform") ?? DEFAULT_PLATFORM;
  const arch = readArch(c.req.query("arch"));
  if (!isPlatform(platformParam)) return c.json({ error: "Invalid platform" }, 400);

  const resolved = resolveLatest(channel, platformParam, arch);
  if (!resolved?.artifact) return c.json({ error: "No release found" }, 404);

  return c.json({
    version: resolved.release.version,
    name: resolved.release.name,
    channel: resolved.release.channel,
    publishedAt: resolved.release.publishedAt?.toISOString() ?? null,
    fileName: resolved.artifact.fileName,
    fileSize: resolved.artifact.size,
    sha256: resolved.artifact.sha256,
    downloadUrl: `/update/download/${platformParam}?channel=${channel}&arch=${arch}`,
  });
});
