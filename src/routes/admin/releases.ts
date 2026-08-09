import { Hono } from "hono";
import {
  DOWNLOAD_COUNT_MAX,
  ReleaseError,
  createRelease,
  type CreateReleaseInput,
  deleteRelease,
  listReleaseSummaries,
  requireReleaseRow,
  setReleaseDownloadCount,
  toReleaseDTO,
  updateRelease,
} from "../../services/releases.js";
import { saveChangelog } from "../../services/changelog.js";
import { logAction } from "../../services/audit.js";
import { clientIp, handle, readJson, requireInteger, requireString } from "../helpers.js";
import {
  isChangelogType,
  isChannel,
  isLocale,
  isReleaseStatus,
  type Channel,
  type ChangelogType,
  type ReleaseStatus,
} from "../../types.js";

export const releasesRouter = new Hono();

releasesRouter.get("/", (c) => handle(c, () => ({ releases: listReleaseSummaries() })));

releasesRouter.get("/:id", (c) =>
  handle(c, () => ({ release: toReleaseDTO(requireReleaseRow(c.req.param("id"))) })),
);

releasesRouter.post("/", (c) =>
  handle(c, async () => {
    const body = await readJson<{
      version?: unknown;
      channel?: unknown;
      name?: unknown;
      mandatory?: unknown;
      minSupportedVersion?: unknown;
      rolloutPercent?: unknown;
    }>(c);

    const input: CreateReleaseInput = {
      version: requireString(body.version, "version"),
      channel: isChannel(body.channel) ? body.channel : "stable",
      mandatory: body.mandatory === true,
      minSupportedVersion:
        typeof body.minSupportedVersion === "string" ? body.minSupportedVersion : null,
      rolloutPercent: typeof body.rolloutPercent === "number" ? body.rolloutPercent : 100,
    };
    if (typeof body.name === "string") input.name = body.name;

    const release = createRelease(input);
    logAction("release.create", release.version, { channel: release.channel }, clientIp(c));
    return { release };
  }),
);

releasesRouter.patch("/:id", (c) =>
  handle(c, async () => {
    const id = c.req.param("id");
    const body = await readJson<Record<string, unknown>>(c);

    const patch: {
      channel?: Channel;
      name?: string;
      mandatory?: boolean;
      minSupportedVersion?: string | null;
      rolloutPercent?: number;
      status?: ReleaseStatus;
    } = {};

    if (isChannel(body.channel)) patch.channel = body.channel;
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.mandatory === "boolean") patch.mandatory = body.mandatory;
    if (typeof body.minSupportedVersion === "string" || body.minSupportedVersion === null) {
      patch.minSupportedVersion = body.minSupportedVersion as string | null;
    }
    if (typeof body.rolloutPercent === "number") patch.rolloutPercent = body.rolloutPercent;
    if (body.status !== undefined) {
      if (!isReleaseStatus(body.status)) throw new ReleaseError("올바르지 않은 status입니다.");
      patch.status = body.status;
    }

    const release = updateRelease(id, patch);
    if (patch.status) {
      logAction(`release.${patch.status}`, release.version, null, clientIp(c));
    }
    return { release };
  }),
);

/**
 * PATCH /admin/api/releases/:id/downloads — 다운로드 수 보정.
 * 통계 정리로 실수로 지운 기록을 숫자만 되살리는 도구다. 되돌리기 어려워 감사 로그에 남긴다.
 */
releasesRouter.patch("/:id/downloads", (c) =>
  handle(c, async () => {
    const body = await readJson<{ count?: unknown }>(c);
    const count = requireInteger(body.count, "다운로드 수", { min: 0, max: DOWNLOAD_COUNT_MAX });
    const result = setReleaseDownloadCount(c.req.param("id"), count);
    logAction(
      "release.downloads.adjust",
      result.version,
      { count: result.downloadCount, added: result.added, removed: result.removed },
      clientIp(c),
    );
    return result;
  }),
);

releasesRouter.delete("/:id", (c) =>
  handle(c, async () => {
    const row = requireReleaseRow(c.req.param("id"));
    const result = await deleteRelease(row.id);
    logAction("release.delete", row.version, result, clientIp(c));
    return { deleted: true, ...result };
  }),
);

// ─── 체인지로그 ──────────────────────────────────────────────────────────────

releasesRouter.put("/:id/changelog/:locale", (c) =>
  handle(c, async () => {
    const release = requireReleaseRow(c.req.param("id"));
    const locale = c.req.param("locale");
    if (!isLocale(locale)) throw new ReleaseError("지원하지 않는 로케일입니다.");

    const body = await readJson<{
      summary?: unknown;
      bodyMarkdown?: unknown;
      items?: unknown;
    }>(c);

    const input: Parameters<typeof saveChangelog>[2] = {};
    if (typeof body.summary === "string") input.summary = body.summary;
    if (typeof body.bodyMarkdown === "string") input.bodyMarkdown = body.bodyMarkdown;
    if (Array.isArray(body.items)) input.items = parseItems(body.items);

    const changelog = saveChangelog(release.id, locale, input);
    logAction("changelog.save", `${release.version}/${locale}`, null, clientIp(c));
    return { changelog };
  }),
);

function parseItems(raw: unknown[]): { type: ChangelogType; text: string }[] {
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { type, text } = entry as { type?: unknown; text?: unknown };
    if (typeof text !== "string" || !text.trim()) return [];
    return [{ type: isChangelogType(type) ? type : "changed", text: text.trim() }];
  });
}
