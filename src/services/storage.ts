// 아티팩트 오브젝트 스토리지 (S3 호환 — 현재 Cloudflare R2의 picell-one 버킷).
// picell-works-cloud의 packages/core/storage.ts를 이 프로젝트 규모에 맞게 승계했다:
// provider-중립 유지, env는 lazy 초기화 후 캐싱, dev/prod 키 격리 프리픽스 지원.
//
// 키 스키마: `releases/{version}/{platform}-{arch}/{fileName}`
// 버전 폴더 단위로 사람이 R2 콘솔에서 바로 알아볼 수 있고, 릴리즈 삭제는
// deleteByPrefix(`releases/{version}/`) 한 번으로 끝난다. **이 형태를 깨지 말 것.**
//
// 버킷은 private. 업로드는 presigned PUT으로 브라우저↔R2 직결(서버 메모리·요청
// 크기 제한 회피), 다운로드는 공개 도메인(STORAGE_PUBLIC_BASE_URL)이 있으면 그쪽,
// 없으면 presigned GET으로 리다이렉트한다.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { optionalEnv, requireEnv, numberEnv } from "../env.js";
import type { Arch, Platform } from "../types.js";

/** presigned PUT 만료. 대용량 업로드가 끝날 만큼은 길어야 한다. */
const PRESIGNED_PUT_TTL_SEC = numberEnv("STORAGE_PUT_TTL_SEC", 60 * 60);
/** 다운로드 리다이렉트용 presigned GET 만료. 짧게 유지 — 링크 유출 창을 줄인다. */
export const PRESIGNED_GET_TTL_SEC = numberEnv("STORAGE_GET_TTL_SEC", 10 * 60);
const DELETE_BATCH_MAX = 1000; // S3 DeleteObjects 한 요청 상한

export const ARTIFACT_ROOT = "releases";

// ─── 키 ──────────────────────────────────────────────────────────────────────

/** 파일명에서 경로 구분자·제어문자를 털어낸다 (키 인젝션 방지). */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "file";
}

export function keyForArtifact(
  version: string,
  platform: Platform,
  arch: Arch,
  fileName: string,
): string {
  return `${ARTIFACT_ROOT}/${version}/${platform}-${arch}/${sanitizeFileName(fileName)}`;
}

export function keyPrefixForRelease(version: string): string {
  return `${ARTIFACT_ROOT}/${version}/`;
}

// dev와 prod가 같은 버킷을 공유할 때 로컬 업로드가 운영 스캔에 섞이지 않도록 물리
// 키 앞에 환경 프리픽스를 붙인다. DB·앱 로직은 논리 키(프리픽스 없음)만 다루고,
// 프리픽스는 이 파일의 S3 경계 함수 안에서만 적용된다.
let _prefix: string | null = null;
export function storagePrefix(): string {
  if (_prefix !== null) return _prefix;
  const raw = optionalEnv("STORAGE_KEY_PREFIX");
  _prefix = raw ? (raw.endsWith("/") ? raw : `${raw}/`) : "";
  return _prefix;
}

function physicalKey(logicalKey: string): string {
  return `${storagePrefix()}${logicalKey}`;
}

/** 물리 키에서 환경 프리픽스를 떼어 논리 키로. 리스팅 결과를 DB와 대조할 때 쓴다. */
export function logicalKey(physical: string): string {
  const p = storagePrefix();
  return p && physical.startsWith(p) ? physical.slice(p.length) : physical;
}

// ─── 클라이언트 ──────────────────────────────────────────────────────────────

let _client: S3Client | null = null;
let _bucket: string | null = null;

/** 스토리지 env가 갖춰졌는지. 미설정이면 콘솔이 설정 안내를 띄운다(부팅은 막지 않음). */
export function isStorageConfigured(): boolean {
  return Boolean(
    optionalEnv("STORAGE_ENDPOINT") &&
      optionalEnv("STORAGE_ACCESS_KEY_ID") &&
      optionalEnv("STORAGE_SECRET_ACCESS_KEY") &&
      optionalEnv("STORAGE_BUCKET"),
  );
}

export function bucketName(): string {
  return optionalEnv("STORAGE_BUCKET") ?? "";
}

function s3(): { client: S3Client; bucket: string } {
  if (_client && _bucket) return { client: _client, bucket: _bucket };
  const endpoint = requireEnv("STORAGE_ENDPOINT");
  const accessKeyId = requireEnv("STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("STORAGE_SECRET_ACCESS_KEY");
  const bucket = requireEnv("STORAGE_BUCKET");
  _client = new S3Client({
    region: optionalEnv("STORAGE_REGION") ?? "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  _bucket = bucket;
  return { client: _client, bucket };
}

// ─── URL ─────────────────────────────────────────────────────────────────────

/**
 * 공개 커스텀 도메인이 붙어 있으면 그 URL, 아니면 null(→ presigned GET 사용).
 *
 * 키의 각 세그먼트는 URL 인코딩한다. 파일명에 공백이 있으면(`PiCell One.pdb`) 날것
 * 그대로는 Location 헤더로 나갈 수 없는 URL이 된다 — presigned 쪽은 SDK가 알아서
 * 인코딩하므로 이 경로만 어긋나 있었다.
 */
export function publicUrlFor(key: string): string | null {
  const base = optionalEnv("STORAGE_PUBLIC_BASE_URL");
  if (!base) return null;
  const path = physicalKey(key).split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/$/, "")}/${path}`;
}

export async function presignPut(key: string, contentType: string): Promise<string> {
  const { client, bucket } = s3();
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: physicalKey(key), ContentType: contentType }),
    { expiresIn: PRESIGNED_PUT_TTL_SEC },
  );
}

/** 다운로드용 presigned GET — 브라우저가 원래 파일명으로 저장하도록 강제한다. */
export async function presignDownload(key: string, fileName: string): Promise<string> {
  const { client, bucket } = s3();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: physicalKey(key),
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    }),
    { expiresIn: PRESIGNED_GET_TTL_SEC },
  );
}

/** 실제 다운로드로 보낼 URL. 공개 도메인 우선, 없으면 presigned. */
export async function downloadUrlFor(key: string, fileName: string): Promise<string> {
  return publicUrlFor(key) ?? (await presignDownload(key, fileName));
}

// ─── 오브젝트 조작 ───────────────────────────────────────────────────────────

export async function headObject(
  key: string,
): Promise<{ size: number; contentType?: string | undefined } | null> {
  const { client, bucket } = s3();
  try {
    const res = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: physicalKey(key) }),
    );
    return { size: res.ContentLength ?? 0, contentType: res.ContentType };
  } catch {
    return null;
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { client, bucket } = s3();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: physicalKey(key),
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** 스트림을 멀티파트로 올린다. URL 임포트가 100MB+ 바이너리를 메모리에 안 쌓게. */
export async function uploadStream(
  key: string,
  body: Readable | ReadableStream,
  contentType: string,
): Promise<void> {
  const { client, bucket } = s3();
  const up = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: physicalKey(key),
      Body: body as Readable,
      ContentType: contentType,
    },
  });
  await up.done();
}

export async function getObjectStream(key: string): Promise<Readable> {
  const { client, bucket } = s3();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: physicalKey(key) }));
  if (!res.Body) throw new Error(`empty body for ${key}`);
  return res.Body as Readable;
}

/**
 * 업로드된 오브젝트의 sha256을 R2에서 되읽어 계산한다.
 * 브라우저에서 해시를 받지 않는 이유: 클라이언트 계산값은 신뢰 근거가 없고,
 * 대용량 파일을 브라우저 메모리에 통째로 올려야 한다. R2→서버 스트리밍은
 * 같은 Cloudflare 망 안이라 비용이 사실상 없다.
 */
export async function hashObject(key: string): Promise<string> {
  const stream = await getObjectStream(key);
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function deleteObject(key: string): Promise<void> {
  const { client, bucket } = s3();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: physicalKey(key) }));
}

/** 논리 프리픽스 하위 전체 삭제(페이지네이션). 릴리즈 통째 정리에 쓴다. */
export async function deleteByPrefix(prefix: string): Promise<number> {
  const { client, bucket } = s3();
  let deleted = 0;
  let token: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: physicalKey(prefix),
        ContinuationToken: token,
      }),
    );
    const contents = list.Contents ?? [];
    if (contents.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: contents.map((c) => ({ Key: c.Key! })) },
        }),
      );
      deleted += contents.length;
    }
    token = list.NextContinuationToken;
  } while (token);
  return deleted;
}

/** 논리 키를 그대로 삭제(최대 1000/배치). 스토리지 정리 도구 전용. */
export async function deleteKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { client, bucket } = s3();
  for (let i = 0; i < keys.length; i += DELETE_BATCH_MAX) {
    const batch = keys.slice(i, i + DELETE_BATCH_MAX);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((k) => ({ Key: physicalKey(k) })) },
      }),
    );
  }
}

/**
 * S3 SDK 오류를 사람이 고칠 수 있는 메시지로 바꾼다.
 * 설정 실수(토큰 스코프·오타)가 압도적으로 흔한데, 그대로 두면 콘솔에 500과
 * SDK 스택만 뜬다. 해당 없는 오류는 null을 돌려 원래 처리에 맡긴다.
 */
export function storageErrorMessage(e: unknown): string | null {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  const bucket = bucketName() || "(STORAGE_BUCKET 미설정)";
  switch (err?.name) {
    case "AccessDenied":
      return `R2 자격증명이 '${bucket}' 버킷에 접근할 수 없습니다. API 토큰이 다른 버킷에만 스코프돼 있지 않은지 확인하세요.`;
    case "NoSuchBucket":
      return `R2 버킷 '${bucket}'을(를) 찾을 수 없습니다. STORAGE_BUCKET 값과 버킷 존재 여부를 확인하세요.`;
    case "InvalidAccessKeyId":
      return "STORAGE_ACCESS_KEY_ID가 올바르지 않습니다.";
    case "SignatureDoesNotMatch":
      return "STORAGE_SECRET_ACCESS_KEY가 올바르지 않습니다.";
  }
  // R2는 스코프 밖 버킷의 HeadBucket에 이름 없는 403을 준다.
  if (err?.$metadata?.httpStatusCode === 403) {
    return `R2가 '${bucket}' 버킷 접근을 거부했습니다(403). API 토큰의 버킷 스코프와 권한을 확인하세요.`;
  }
  return null;
}

export type StorageObject = { key: string; size: number; lastModified: Date | null };

/** 아티팩트 루트 하위를 페이지네이션 스캔. 반환 키는 **논리 키**. */
export async function listObjects(prefix = `${ARTIFACT_ROOT}/`): Promise<StorageObject[]> {
  const { client, bucket } = s3();
  const out: StorageObject[] = [];
  let token: string | undefined;
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: physicalKey(prefix),
        ContinuationToken: token,
      }),
    );
    for (const c of list.Contents ?? []) {
      if (!c.Key) continue;
      out.push({
        key: logicalKey(c.Key),
        size: c.Size ?? 0,
        lastModified: c.LastModified ?? null,
      });
    }
    token = list.NextContinuationToken;
  } while (token);
  return out;
}
