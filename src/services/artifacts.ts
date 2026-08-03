// 아티팩트 업로드 수명주기.
//
// 브라우저 → presigned PUT → R2 직결이 기본 경로다. 서버를 통과시키면 Railway
// 요청 크기 제한과 프로세스 메모리에 100MB+ 바이너리가 걸린다. 서버는 키 발급과
// 완료 검증(HEAD + sha256)만 맡는다.
//
// 두 번째 경로는 URL 임포트 — 서버가 원본 URL을 스트리밍으로 받아 R2에 멀티파트로
// 올린다. GitHub Releases 마이그레이션이 이 경로를 그대로 쓴다.

import { db, newId } from "../db/index.js";
import { artifacts } from "../db/schema.js";
import type { ArtifactRow } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Readable } from "node:stream";
import {
  deleteObject,
  hashObject,
  headObject,
  keyForArtifact,
  presignPut,
  sanitizeFileName,
  uploadStream,
} from "./storage.js";
import { ReleaseError, requireReleaseRow } from "./releases.js";
import type { Arch, ArtifactKind, Platform } from "../types.js";

/** 확장자 → 기본 kind 추정. 관리자가 매번 고르지 않아도 되게. */
const KIND_BY_EXTENSION: Record<string, ArtifactKind> = {
  exe: "installer",
  msi: "installer",
  dmg: "installer",
  pkg: "installer",
  deb: "installer",
  rpm: "installer",
  appimage: "portable",
  zip: "zip",
  blockmap: "blockmap",
};

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  exe: "application/vnd.microsoft.portable-executable",
  msi: "application/x-msi",
  dmg: "application/x-apple-diskimage",
  zip: "application/zip",
  blockmap: "application/octet-stream",
};

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function guessKind(fileName: string): ArtifactKind {
  return KIND_BY_EXTENSION[extensionOf(fileName)] ?? "other";
}

export function guessContentType(fileName: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extensionOf(fileName)] ?? "application/octet-stream";
}

export function getArtifactRow(id: string): ArtifactRow | undefined {
  return db.select().from(artifacts).where(eq(artifacts.id, id)).get();
}

export function requireArtifactRow(id: string): ArtifactRow {
  const row = getArtifactRow(id);
  if (!row) throw new ReleaseError("아티팩트를 찾을 수 없습니다.", 404);
  return row;
}

export interface PrepareUploadInput {
  releaseId: string;
  fileName: string;
  platform: Platform;
  arch: Arch;
  kind?: ArtifactKind;
  contentType?: string;
  size?: number;
}

export interface PrepareUploadResult {
  artifact: ArtifactRow;
  uploadUrl: string;
}

/**
 * 업로드 자리를 잡고 presigned PUT URL을 발급한다.
 * 같은 (릴리즈, 파일명, 플랫폼, arch) 조합이 이미 있으면 기존 행을 재사용해
 * 실패한 업로드를 그대로 재시도할 수 있게 한다(고아 행이 쌓이지 않는다).
 */
export async function prepareUpload(input: PrepareUploadInput): Promise<PrepareUploadResult> {
  const release = requireReleaseRow(input.releaseId);
  const fileName = sanitizeFileName(input.fileName);
  if (!fileName) throw new ReleaseError("파일명이 비어 있습니다.");

  const storageKey = keyForArtifact(release.version, input.platform, input.arch, fileName);
  const contentType = input.contentType || guessContentType(fileName);
  const kind = input.kind ?? guessKind(fileName);

  const existing = db.select().from(artifacts).where(eq(artifacts.storageKey, storageKey)).get();

  let row: ArtifactRow;
  if (existing) {
    const patch = {
      kind,
      contentType,
      size: input.size ?? 0,
      sha256: null,
      status: "uploading",
      uploadedAt: null,
    } satisfies Partial<ArtifactRow>;
    db.update(artifacts).set(patch).where(eq(artifacts.id, existing.id)).run();
    row = { ...existing, ...patch };
  } else {
    row = {
      id: newId(),
      releaseId: release.id,
      platform: input.platform,
      arch: input.arch,
      kind,
      fileName,
      storageKey,
      size: input.size ?? 0,
      sha256: null,
      contentType,
      status: "uploading",
      createdAt: new Date(),
      uploadedAt: null,
    };
    db.insert(artifacts).values(row).run();
  }

  return { artifact: row, uploadUrl: await presignPut(storageKey, contentType) };
}

/**
 * 업로드 완료 확정. R2에 객체가 실제로 도착했는지 HEAD로 확인하고 sha256을 계산한다.
 * 객체가 없으면 ready로 올리지 않는다 — 클라이언트 보고만 믿으면 깨진 릴리즈가 발행된다.
 */
export async function completeUpload(artifactId: string): Promise<ArtifactRow> {
  const row = requireArtifactRow(artifactId);
  const head = await headObject(row.storageKey);
  if (!head) {
    throw new ReleaseError("R2에서 업로드된 파일을 찾을 수 없습니다. 업로드를 다시 시도하세요.");
  }
  const sha256 = await hashObject(row.storageKey);
  const patch = {
    size: head.size,
    sha256,
    status: "ready",
    uploadedAt: new Date(),
  } satisfies Partial<ArtifactRow>;
  db.update(artifacts).set(patch).where(eq(artifacts.id, artifactId)).run();
  return { ...row, ...patch };
}

export interface ImportUrlInput {
  releaseId: string;
  url: string;
  fileName?: string;
  platform: Platform;
  arch: Arch;
  kind?: ArtifactKind;
}

/** 원격 URL을 R2로 스트리밍 복사한다(GitHub 에셋 이관 포함). */
export async function importFromUrl(
  input: ImportUrlInput,
  headers: Record<string, string> = {},
): Promise<ArtifactRow> {
  const release = requireReleaseRow(input.releaseId);
  const fileName = sanitizeFileName(
    input.fileName || decodeURIComponent(new URL(input.url).pathname.split("/").pop() || "file"),
  );
  const storageKey = keyForArtifact(release.version, input.platform, input.arch, fileName);
  const contentType = guessContentType(fileName);
  const kind = input.kind ?? guessKind(fileName);

  const res = await fetch(input.url, { headers, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new ReleaseError(`원본 다운로드 실패: ${res.status} ${res.statusText}`, 502);
  }

  await uploadStream(storageKey, Readable.fromWeb(res.body as never), contentType);

  const existing = db.select().from(artifacts).where(eq(artifacts.storageKey, storageKey)).get();
  const head = await headObject(storageKey);
  const sha256 = await hashObject(storageKey);
  const base = {
    releaseId: release.id,
    platform: input.platform,
    arch: input.arch,
    kind,
    fileName,
    storageKey,
    size: head?.size ?? 0,
    sha256,
    contentType,
    status: "ready" as const,
    uploadedAt: new Date(),
  };

  if (existing) {
    db.update(artifacts).set(base).where(eq(artifacts.id, existing.id)).run();
    return { ...existing, ...base };
  }
  const row: ArtifactRow = { id: newId(), createdAt: new Date(), ...base };
  db.insert(artifacts).values(row).run();
  return row;
}

/** 아티팩트 행과 R2 오브젝트를 함께 제거. */
export async function deleteArtifact(artifactId: string): Promise<void> {
  const row = requireArtifactRow(artifactId);
  await deleteObject(row.storageKey);
  db.delete(artifacts).where(eq(artifacts.id, artifactId)).run();
}

export interface UpdateArtifactInput {
  platform?: Platform;
  arch?: Arch;
  kind?: ArtifactKind;
}

/** 분류(플랫폼/arch/kind)만 수정. 키가 바뀌는 항목은 재업로드가 맞다. */
export function updateArtifactMeta(id: string, input: UpdateArtifactInput): ArtifactRow {
  const row = requireArtifactRow(id);
  const patch: Partial<ArtifactRow> = {};
  if (input.platform !== undefined) patch.platform = input.platform;
  if (input.arch !== undefined) patch.arch = input.arch;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (Object.keys(patch).length === 0) return row;
  db.update(artifacts).set(patch).where(eq(artifacts.id, id)).run();
  return { ...row, ...patch };
}

/** 업로드만 걸어놓고 끝내지 않은 잔재 행 정리 (스토리지 도구에서 호출). */
export function listStaleUploads(olderThanMs: number): ArtifactRow[] {
  const cutoff = new Date(Date.now() - olderThanMs);
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.status, "uploading"))
    .all()
    .filter((r) => r.createdAt < cutoff);
}
