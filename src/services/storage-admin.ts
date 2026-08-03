// R2 점검 도구 — 버킷 실물과 DB를 대조한다.
//
// 두 방향으로 어긋날 수 있다:
//  - 고아(orphan): R2에 있는데 아티팩트 행이 없다 (릴리즈 삭제 실패, 중단된 업로드)
//  - 누락(missing): 아티팩트 행은 있는데 R2에 파일이 없다 (업로드가 끝나지 않음)
// 후자를 발행 전에 잡는 게 중요하다 — 다운로드가 404 나는 릴리즈를 막는다.
//
// works-cloud의 orphan-storage와 달리 여기 버킷(picell-one)은 이 서비스 전용이라
// "모르는 키 = 고아" 판정이 안전하다. 다만 삭제는 releases/ 프리픽스 안으로만
// 제한해, 나중에 같은 버킷에 다른 용도가 생겨도 오삭제가 나지 않게 한다.

import { db } from "../db/index.js";
import { artifacts, releases } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { ARTIFACT_ROOT, deleteKeys, headObject, listObjects } from "./storage.js";
import type { StorageObjectDTO, StorageOverviewDTO } from "../types.js";
import { bucketName, storagePrefix } from "./storage.js";

export async function storageOverview(): Promise<StorageOverviewDTO> {
  const objects = await listObjects();
  const artifactRows = db.select().from(artifacts).all();
  const releaseRows = db.select().from(releases).all();

  const versionById = new Map(releaseRows.map((r) => [r.id, r.version]));
  const artifactByKey = new Map(artifactRows.map((a) => [a.storageKey, a]));
  const objectKeys = new Set(objects.map((o) => o.key));

  const dtos: StorageObjectDTO[] = objects.map((o) => {
    const artifact = artifactByKey.get(o.key);
    return {
      key: o.key,
      size: o.size,
      lastModified: o.lastModified?.toISOString() ?? null,
      linked: Boolean(artifact),
      releaseVersion: artifact ? (versionById.get(artifact.releaseId) ?? null) : null,
    };
  });
  dtos.sort((a, b) => a.key.localeCompare(b.key));

  const orphans = dtos.filter((d) => !d.linked);
  const missing = artifactRows
    .filter((a) => !objectKeys.has(a.storageKey))
    .map((a) => ({
      artifactId: a.id,
      version: versionById.get(a.releaseId) ?? "?",
      storageKey: a.storageKey,
    }));

  return {
    bucket: bucketName(),
    prefix: storagePrefix(),
    objectCount: dtos.length,
    totalBytes: dtos.reduce((sum, d) => sum + d.size, 0),
    orphanCount: orphans.length,
    orphanBytes: orphans.reduce((sum, d) => sum + d.size, 0),
    missingCount: missing.length,
    objects: dtos,
    missing,
  };
}

export interface CleanupResult {
  deleted: string[];
  skipped: { key: string; reason: "linked" | "out-of-scope" }[];
}

/**
 * 고아 오브젝트 삭제. 스캔 결과를 그대로 믿지 않고 서버에서 다시 검증한다
 * (스캔↔삭제 사이에 업로드가 끝나 링크가 생겼을 수 있다).
 */
export async function cleanupOrphans(keys: string[]): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: [], skipped: [] };
  const scope = `${ARTIFACT_ROOT}/`;

  for (const key of keys) {
    if (!key.startsWith(scope)) {
      result.skipped.push({ key, reason: "out-of-scope" });
      continue;
    }
    const linked = db.select().from(artifacts).where(eq(artifacts.storageKey, key)).get();
    if (linked) {
      result.skipped.push({ key, reason: "linked" });
      continue;
    }
    result.deleted.push(key);
  }

  await deleteKeys(result.deleted);
  return result;
}

/** 아티팩트 행 하나가 R2에 실제로 있는지 즉시 확인 (발행 전 점검용). */
export async function verifyArtifact(artifactId: string): Promise<{ ok: boolean; size: number }> {
  const row = db.select().from(artifacts).where(eq(artifacts.id, artifactId)).get();
  if (!row) return { ok: false, size: 0 };
  const head = await headObject(row.storageKey);
  return { ok: Boolean(head), size: head?.size ?? 0 };
}
