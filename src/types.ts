// 서버 ↔ 관리 콘솔(web) 공유 타입의 단일 출처. web은 값이 아닌 `import type`으로만
// 가져온다 (picell-works-cloud 규칙 8·10 승계 — 서버 번들이 클라이언트로 새지 않게).

// ─── 도메인 열거값 ───────────────────────────────────────────────────────────

export const PLATFORMS = ["windows", "macos", "linux"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const ARCHES = ["x64", "arm64", "universal"] as const;
export type Arch = (typeof ARCHES)[number];

export const ARTIFACT_KINDS = ["installer", "portable", "zip", "blockmap", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const CHANNELS = ["stable", "beta"] as const;
export type Channel = (typeof CHANNELS)[number];

export const RELEASE_STATUSES = ["draft", "published", "archived"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const LOCALES = ["ko", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const CHANGELOG_TYPES = [
  "added",
  "improved",
  "changed",
  "fixed",
  "removed",
  "security",
] as const;
export type ChangelogType = (typeof CHANGELOG_TYPES)[number];

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}
export function isArch(v: unknown): v is Arch {
  return typeof v === "string" && (ARCHES as readonly string[]).includes(v);
}
export function isArtifactKind(v: unknown): v is ArtifactKind {
  return typeof v === "string" && (ARTIFACT_KINDS as readonly string[]).includes(v);
}
export function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}
export function isReleaseStatus(v: unknown): v is ReleaseStatus {
  return typeof v === "string" && (RELEASE_STATUSES as readonly string[]).includes(v);
}
export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}
export function isChangelogType(v: unknown): v is ChangelogType {
  return typeof v === "string" && (CHANGELOG_TYPES as readonly string[]).includes(v);
}

// ─── 관리 콘솔 DTO ───────────────────────────────────────────────────────────

export interface ArtifactDTO {
  id: string;
  releaseId: string;
  platform: Platform;
  arch: Arch;
  kind: ArtifactKind;
  fileName: string;
  storageKey: string;
  size: number;
  sha256: string | null;
  contentType: string;
  status: "uploading" | "ready";
  createdAt: string;
  uploadedAt: string | null;
  downloadCount: number;
}

export interface ChangelogItemDTO {
  id: string;
  type: ChangelogType;
  text: string;
  sortOrder: number;
}

export interface ChangelogDTO {
  locale: Locale;
  summary: string;
  bodyMarkdown: string;
  items: ChangelogItemDTO[];
  /** bodyMarkdown이 비어 있으면 items에서 생성한 결과. 클라이언트에 나가는 최종본. */
  rendered: string;
  updatedAt: string | null;
}

export interface ReleaseDTO {
  id: string;
  version: string;
  channel: Channel;
  name: string;
  status: ReleaseStatus;
  mandatory: boolean;
  minSupportedVersion: string | null;
  rolloutPercent: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  artifacts: ArtifactDTO[];
  changelogs: ChangelogDTO[];
  downloadCount: number;
}

/** 목록용 축약형 — 아티팩트/체인지로그 본문 없이 요약만. */
export interface ReleaseSummaryDTO {
  id: string;
  version: string;
  channel: Channel;
  name: string;
  status: ReleaseStatus;
  mandatory: boolean;
  rolloutPercent: number;
  publishedAt: string | null;
  updatedAt: string;
  artifactCount: number;
  totalBytes: number;
  platforms: Platform[];
  downloadCount: number;
  summary: string;
}

// ─── 클라이언트(데스크톱 앱) 공개 API ────────────────────────────────────────

export interface UpdateCheckResponse {
  updateAvailable: boolean;
  channel: Channel;
  /** 강제 업데이트 여부 — 릴리즈 플래그 또는 minSupportedVersion 미달 */
  mandatory: boolean;
  latest: {
    version: string;
    name: string;
    /** 체인지로그 마크다운 (요청 로케일) */
    notes: string;
    summary: string;
    items: { type: ChangelogType; text: string }[];
    publishedAt: string | null;
    prerelease: boolean;
    downloadUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    sha256: string | null;
  } | null;
}

export interface ChangelogFeedEntry {
  version: string;
  channel: Channel;
  name: string;
  publishedAt: string | null;
  summary: string;
  notes: string;
  items: { type: ChangelogType; text: string }[];
}

// ─── 통계 ────────────────────────────────────────────────────────────────────

export interface StatsResponse {
  total: number;
  uniqueMachines: number;
  last7Days: number;
  last30Days: number;
  byVersion: { version: string; count: number }[];
  byPlatform: { platform: string; count: number }[];
  byChannel: { channel: string; count: number }[];
  daily: { date: string; count: number }[];
  installsByVersion: { version: string; count: number }[];
  activeInstalls: number;
}

// ─── 스토리지 ────────────────────────────────────────────────────────────────

export interface StorageObjectDTO {
  key: string;
  size: number;
  lastModified: string | null;
  /** DB의 아티팩트가 참조하는 키인지 */
  linked: boolean;
  releaseVersion: string | null;
}

export interface StorageOverviewDTO {
  bucket: string;
  prefix: string;
  objectCount: number;
  totalBytes: number;
  orphanCount: number;
  orphanBytes: number;
  missingCount: number;
  objects: StorageObjectDTO[];
  /** DB엔 있으나 R2에 없는 아티팩트 (업로드 실패 잔재) */
  missing: { artifactId: string; version: string; storageKey: string }[];
}
