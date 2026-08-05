// 관리 API 클라이언트. fetch+파싱+에러 처리를 여기 한 곳으로 모은다 (규칙 5).
// 서버 타입은 값이 아닌 `import type`으로만 가져온다 (규칙 10).

import type {
  ChangelogDTO,
  ChangelogType,
  Channel,
  Locale,
  ReleaseDTO,
  ReleaseStatus,
  ReleaseSummaryDTO,
  StatsResponse,
  StorageOverviewDTO,
  Platform,
  Arch,
  ArtifactKind,
  ArtifactDTO,
  InspectedFileNameDTO,
  ChangelogImportEntryDTO,
} from "../../../src/types.js";

const BASE = "/admin/api";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await res.text();
  const data = text ? safeParse(text) : {};

  if (!res.ok) {
    const message =
      (data as { error?: string }).error ?? `요청 실패 (${res.status} ${res.statusText})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

// ─── 세션 ────────────────────────────────────────────────────────────────────

export const api = {
  session: () => get<{ authenticated: boolean; authConfigured: boolean }>("/session"),
  login: (password: string) => post<{ authenticated: boolean }>("/login", { password }),
  logout: () => post<{ authenticated: boolean }>("/logout"),

  config: () =>
    get<{
      storageConfigured: boolean;
      githubConfigured: boolean;
      bucket: string;
      keyPrefix: string;
    }>("/config"),

  // ─── 릴리즈 ────────────────────────────────────────────────────────────────

  listReleases: () => get<{ releases: ReleaseSummaryDTO[] }>("/releases"),
  getRelease: (id: string) => get<{ release: ReleaseDTO }>(`/releases/${id}`),
  createRelease: (input: {
    version: string;
    channel: Channel;
    name?: string;
    mandatory?: boolean;
    minSupportedVersion?: string | null;
    rolloutPercent?: number;
  }) => post<{ release: ReleaseDTO }>("/releases", input),
  updateRelease: (
    id: string,
    input: {
      channel?: Channel;
      name?: string;
      mandatory?: boolean;
      minSupportedVersion?: string | null;
      rolloutPercent?: number;
      status?: ReleaseStatus;
    },
  ) => patch<{ release: ReleaseDTO }>(`/releases/${id}`, input),
  deleteRelease: (id: string) =>
    del<{ deleted: boolean; deletedObjects: number }>(`/releases/${id}`),

  saveChangelog: (
    id: string,
    locale: Locale,
    input: { summary?: string; bodyMarkdown?: string; items?: { type: ChangelogType; text: string }[] },
  ) => put<{ changelog: ChangelogDTO }>(`/releases/${id}/changelog/${locale}`, input),

  // ─── 아티팩트 ──────────────────────────────────────────────────────────────

  presignUpload: (
    releaseId: string,
    input: {
      fileName: string;
      platform: Platform;
      arch: Arch;
      kind?: ArtifactKind;
      contentType?: string;
      size?: number;
    },
  ) =>
    post<{ artifactId: string; storageKey: string; uploadUrl: string }>(
      `/releases/${releaseId}/artifacts/presign`,
      input,
    ),
  completeUpload: (artifactId: string) =>
    post<{ artifact: ArtifactDTO }>(`/artifacts/${artifactId}/complete`),
  importArtifactUrl: (
    releaseId: string,
    input: { url: string; fileName?: string; platform: Platform; arch: Arch; kind?: ArtifactKind },
  ) => post<{ artifact: ArtifactDTO }>(`/releases/${releaseId}/artifacts/import-url`, input),
  updateArtifact: (id: string, input: { platform?: Platform; arch?: Arch; kind?: ArtifactKind }) =>
    patch<{ artifact: ArtifactDTO }>(`/artifacts/${id}`, input),
  verifyArtifact: (id: string) => get<{ ok: boolean; size: number }>(`/artifacts/${id}/verify`),
  deleteArtifact: (id: string) => del<{ deleted: boolean }>(`/artifacts/${id}`),

  // ─── 운영 ──────────────────────────────────────────────────────────────────

  stats: () => get<StatsResponse>("/stats"),
  changelogTimeline: (locale: Locale) =>
    get<{
      entries: {
        id: string;
        version: string;
        channel: Channel;
        name: string;
        status: ReleaseStatus;
        publishedAt: string | null;
        changelog: ChangelogDTO;
      }[];
    }>(`/changelog?locale=${locale}`),

  storage: () =>
    get<{ configured: boolean; overview: StorageOverviewDTO | null }>("/storage"),
  cleanupStorage: (keys: string[]) =>
    post<{ deleted: string[]; skipped: { key: string; reason: string }[] }>("/storage/cleanup", {
      keys,
    }),

  githubPreview: () =>
    get<{
      repo: string;
      tokenConfigured: boolean;
      releases: {
        tagName: string;
        version: string;
        name: string;
        channel: Channel;
        publishedAt: string;
        alreadyImported: boolean;
        assets: { name: string; size: number; url: string; platform: Platform | null; arch: Arch }[];
      }[];
    }>("/github/preview"),
  githubImport: (tagName: string) =>
    post<{
      version: string;
      created: boolean;
      importedAssets: number;
      skippedAssets: string[];
      error: string | null;
    }>("/github/import", { tagName }),

  // ─── 자동 채우기 ───────────────────────────────────────────────────────────

  inspectFileName: (fileName: string) =>
    post<InspectedFileNameDTO>("/inspect/filename", { fileName }),
  /** changelog.txt를 버전 블록으로 갈라 돌려준다. 저장하지 않는다. */
  parseChangelog: (text: string, locale: Locale) =>
    post<{
      locale: Locale;
      entries: ChangelogImportEntryDTO[];
      matched: number;
      unmatched: number;
    }>("/changelog/parse", { text, locale }),

  auditLogs: () =>
    get<{
      logs: {
        id: number;
        action: string;
        target: string | null;
        detail: string | null;
        ip: string | null;
        createdAt: string;
      }[];
    }>("/audit"),
};

/**
 * presigned PUT으로 R2에 직접 올린다. 진행률이 필요해 fetch 대신 XHR을 쓴다
 * (fetch는 업로드 진행 이벤트를 주지 않는다).
 */
export function uploadToR2(
  url: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 업로드 실패 (${xhr.status}). 버킷 CORS 설정을 확인하세요.`));
    });
    xhr.addEventListener("error", () =>
      reject(new Error("R2 업로드 중 네트워크 오류. 버킷 CORS 설정을 확인하세요.")),
    );
    xhr.addEventListener("abort", () => reject(new Error("업로드가 취소되었습니다.")));

    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}
