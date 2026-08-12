import { Hono } from "hono";
import {
  completeUpload,
  deleteArtifact,
  importFromUrl,
  prepareUpload,
  requireArtifactRow,
  updateArtifactMeta,
  type UpdateArtifactInput,
} from "../../services/artifacts.js";
import { ReleaseError, requireReleaseRow } from "../../services/releases.js";
import { verifyArtifact } from "../../services/storage-admin.js";
import {
  isStorageConfigured,
  presignDownload,
  publicUrlFor,
  PRESIGNED_GET_TTL_SEC,
} from "../../services/storage.js";
import { logAction } from "../../services/audit.js";
import { clientIp, handle, readJson, requireString } from "../helpers.js";
import { isArch, isArtifactKind, isPlatform, type Arch, type ArtifactKind } from "../../types.js";

export const artifactsRouter = new Hono();

function assertStorage(): void {
  if (!isStorageConfigured()) {
    throw new ReleaseError(
      "R2 스토리지 환경변수(STORAGE_*)가 설정되지 않았습니다. 설정 후 다시 시도하세요.",
      503,
    );
  }
}

/** POST /admin/api/releases/:id/artifacts/presign — 브라우저 직접 업로드용 URL 발급 */
artifactsRouter.post("/releases/:id/artifacts/presign", (c) =>
  handle(c, async () => {
    assertStorage();
    const release = requireReleaseRow(c.req.param("id"));
    const body = await readJson<Record<string, unknown>>(c);

    const platform = body.platform;
    if (!isPlatform(platform)) throw new ReleaseError("올바르지 않은 platform입니다.");

    const input: Parameters<typeof prepareUpload>[0] = {
      releaseId: release.id,
      fileName: requireString(body.fileName, "fileName"),
      platform,
      arch: isArch(body.arch) ? (body.arch as Arch) : "x64",
    };
    if (isArtifactKind(body.kind)) input.kind = body.kind as ArtifactKind;
    if (typeof body.contentType === "string") input.contentType = body.contentType;
    if (typeof body.size === "number") input.size = body.size;

    const { artifact, uploadUrl } = await prepareUpload(input);
    return { artifactId: artifact.id, storageKey: artifact.storageKey, uploadUrl };
  }),
);

/** POST /admin/api/artifacts/:id/complete — R2 도착 확인 + sha256 확정 */
artifactsRouter.post("/artifacts/:id/complete", (c) =>
  handle(c, async () => {
    assertStorage();
    const artifact = await completeUpload(c.req.param("id"));
    logAction("artifact.upload", artifact.fileName, { size: artifact.size }, clientIp(c));
    return { artifact };
  }),
);

/** POST /admin/api/releases/:id/artifacts/import-url — 원격 URL을 R2로 복사 */
artifactsRouter.post("/releases/:id/artifacts/import-url", (c) =>
  handle(c, async () => {
    assertStorage();
    const release = requireReleaseRow(c.req.param("id"));
    const body = await readJson<Record<string, unknown>>(c);

    const platform = body.platform;
    if (!isPlatform(platform)) throw new ReleaseError("올바르지 않은 platform입니다.");

    const input: Parameters<typeof importFromUrl>[0] = {
      releaseId: release.id,
      url: requireString(body.url, "url"),
      platform,
      arch: isArch(body.arch) ? (body.arch as Arch) : "x64",
    };
    if (typeof body.fileName === "string" && body.fileName.trim()) input.fileName = body.fileName;
    if (isArtifactKind(body.kind)) input.kind = body.kind as ArtifactKind;

    const artifact = await importFromUrl(input);
    logAction("artifact.import", artifact.fileName, { url: input.url }, clientIp(c));
    return { artifact };
  }),
);

artifactsRouter.patch("/artifacts/:id", (c) =>
  handle(c, async () => {
    const body = await readJson<Record<string, unknown>>(c);
    const patch: UpdateArtifactInput = {};
    if (isPlatform(body.platform)) patch.platform = body.platform;
    if (isArch(body.arch)) patch.arch = body.arch;
    if (isArtifactKind(body.kind)) patch.kind = body.kind;
    return { artifact: updateArtifactMeta(c.req.param("id"), patch) };
  }),
);

/**
 * GET /admin/api/artifacts/:id/download-url — 파일 공유용 다운로드 링크 발급.
 * 공개 도메인이 있으면 만료 없는 그 URL, 없으면 presigned GET(만료 있음)을 준다.
 * 발행 전 릴리즈의 파일도 받아볼 수 있어야 하므로 릴리즈 상태는 따지지 않는다.
 */
artifactsRouter.get("/artifacts/:id/download-url", (c) =>
  handle(c, async () => {
    assertStorage();
    const row = requireArtifactRow(c.req.param("id"));
    const publicUrl = publicUrlFor(row.storageKey);
    if (publicUrl) return { url: publicUrl, expiresInSec: null };
    return {
      url: await presignDownload(row.storageKey, row.fileName),
      expiresInSec: PRESIGNED_GET_TTL_SEC,
    };
  }),
);

artifactsRouter.get("/artifacts/:id/verify", (c) =>
  handle(c, async () => {
    assertStorage();
    return verifyArtifact(c.req.param("id"));
  }),
);

artifactsRouter.delete("/artifacts/:id", (c) =>
  handle(c, async () => {
    assertStorage();
    const row = requireArtifactRow(c.req.param("id"));
    await deleteArtifact(row.id);
    logAction("artifact.delete", row.fileName, { key: row.storageKey }, clientIp(c));
    return { deleted: true };
  }),
);
