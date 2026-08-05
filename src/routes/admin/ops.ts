// 운영 도구 — 통계, 스토리지 점검, GitHub 임포트, 감사 로그.

import { Hono } from "hono";
import { getStats } from "../../services/stats.js";
import { cleanupOrphans, storageOverview } from "../../services/storage-admin.js";
import { bucketName, isStorageConfigured, storagePrefix } from "../../services/storage.js";
import { githubConfig, importRelease, isGithubConfigured, previewImport } from "../../services/github.js";
import { listAuditLogs, logAction, trimAuditLogs } from "../../services/audit.js";
import { listChangelogTimeline } from "../../services/releases.js";
import { ReleaseError } from "../../services/releases.js";
import { clientIp, handle, readJson, requireString } from "../helpers.js";
import { isLocale } from "../../types.js";

// 바꾸면 도구 페이지 "감사 로그" 카드의 설명 문구도 함께 고칠 것.
const AUDIT_LIMIT = 200;

export const opsRouter = new Hono();

opsRouter.get("/stats", (c) => handle(c, () => getStats()));

/** GET /admin/api/changelog?locale=ko — 전체 릴리즈 노트 타임라인 */
opsRouter.get("/changelog", (c) =>
  handle(c, () => {
    const locale = c.req.query("locale");
    return { entries: listChangelogTimeline(isLocale(locale) ? locale : "ko") };
  }),
);

opsRouter.get("/storage", (c) =>
  handle(c, async () => {
    if (!isStorageConfigured()) {
      return {
        configured: false,
        bucket: bucketName(),
        prefix: storagePrefix(),
        overview: null,
      };
    }
    return { configured: true, overview: await storageOverview() };
  }),
);

opsRouter.post("/storage/cleanup", (c) =>
  handle(c, async () => {
    const body = await readJson<{ keys?: unknown }>(c);
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new ReleaseError("삭제할 키 목록이 비어 있습니다.");
    }
    const keys = body.keys.filter((k): k is string => typeof k === "string");
    const result = await cleanupOrphans(keys);
    logAction("storage.cleanup", null, { deleted: result.deleted.length }, clientIp(c));
    return result;
  }),
);

// ─── GitHub 임포트 (일회성 이관 도구) ────────────────────────────────────────

opsRouter.get("/github/preview", (c) =>
  handle(c, async () => {
    if (!isGithubConfigured()) throw new ReleaseError("GITHUB_OWNER/GITHUB_REPO가 없습니다.", 503);
    const { owner, repo, token } = githubConfig();
    return {
      repo: `${owner}/${repo}`,
      tokenConfigured: Boolean(token),
      releases: await previewImport(),
    };
  }),
);

opsRouter.post("/github/import", (c) =>
  handle(c, async () => {
    if (!isStorageConfigured()) {
      throw new ReleaseError("R2 스토리지가 설정되지 않아 임포트할 수 없습니다.", 503);
    }
    const body = await readJson<{ tagName?: unknown }>(c);
    const tagName = requireString(body.tagName, "tagName");
    const result = await importRelease(tagName);
    logAction("github.import", tagName, result, clientIp(c));
    return result;
  }),
);

// ─── 감사 로그 ───────────────────────────────────────────────────────────────

opsRouter.get("/audit", (c) => handle(c, () => ({ logs: listAuditLogs(AUDIT_LIMIT) })));

opsRouter.post("/audit/trim", (c) =>
  handle(c, () => {
    trimAuditLogs();
    return { trimmed: true };
  }),
);
