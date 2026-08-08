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
  /**
   * 강제 업데이트 여부. 최신 릴리즈뿐 아니라 **현재 버전과 최신 사이의 릴리즈**가
   * 건 조건까지 반영한다(중간 릴리즈의 강제 지정이 이후 릴리즈로 승계된다).
   */
  mandatory: boolean;
  /** 강제 조건을 처음 건 릴리즈 버전. mandatory가 false면 null. */
  mandatorySince: string | null;
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

/** 업데이트 확인 활동 로그에서 나오는 고유 PC 수. 각 창은 오늘을 포함한다. */
export interface ActiveUserStats {
  today: number;
  last7Days: number;
  last30Days: number;
  /** 로그가 시작된 이래 한 번이라도 확인을 보낸 PC */
  allTime: number;
}

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
  /** 최근 14일 확인 기준. 구 `/api/stats` 소비자와의 호환으로 남긴다. */
  activeInstalls: number;
  activeUsers: ActiveUserStats;
  /** 일별 활성 PC (최근 30일, 빈 날은 0으로 채움) */
  dailyActiveUsers: { date: string; count: number }[];
  /** 최근 30일 활성 PC의 현재 버전 분포 */
  activeByVersion: { version: string; count: number }[];
}

/** 활동 로그가 남은 PC 한 대. `/admin/api/activity` 전용. */
export interface ActiveMachineDTO {
  machineId: string;
  /** 마지막으로 보고한 현재 사용 버전 */
  version: string;
  channel: string;
  platform: string;
  arch: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** 누적 업데이트 확인 횟수 */
  checkCount: number;
  /** 최근 30일 중 확인이 있었던 날 수 */
  activeDays: number;
  /** 로그 전체 기간 중 확인이 있었던 날 수 */
  totalDays: number;
}

export interface ActivityResponse {
  /** `activeDays`의 집계 창 */
  windowDays: number;
  /** `machines`에 담긴 최대 행 수 */
  limit: number;
  /** 로그가 남은 전체 PC 수 (limit과 무관) */
  totalMachines: number;
  machines: ActiveMachineDTO[];
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

// ─── 자동 채우기 (파일명 추론 · 체인지로그 임포트) ───────────────────────────

export interface InspectedFileNameDTO {
  fileName: string;
  version: string | null;
  channel: Channel;
  productName: string | null;
  suggestedName: string | null;
  platform: Platform | null;
  arch: Arch;
  kind: ArtifactKind;
  /** 같은 버전의 릴리즈가 이미 있으면 그 id */
  existingReleaseId: string | null;
}

export interface ChangelogImportEntryDTO {
  rawVersion: string;
  version: string | null;
  date: string | null;
  isLatest: boolean;
  itemCount: number;
  markdown: string;
  items: { type: ChangelogType; text: string }[];
  /** 매칭된 릴리즈. null이면 반영 대상이 아니다. */
  releaseId: string | null;
  releaseName: string | null;
}
