// GitHub Releases 임포트 — **런타임 의존이 아니라 이관 도구**다.
//
// 구 서버는 매 업데이트 확인마다 GitHub API를 조회해 레이트 리밋에 걸리면 502를
// 냈다. 이제 배포의 1차 출처는 R2 + 우리 DB이고, GitHub는 과거 릴리즈를 한 번
// 끌어오는 소스로만 쓴다. 임포트가 끝나면 GITHUB_TOKEN 없이도 서비스가 돈다.

import { optionalEnv } from "../env.js";
import { normalizeVersion, isValidVersion, isPrerelease } from "../version.js";
import { createRelease, getReleaseRowByVersion, ReleaseError } from "./releases.js";
import { importFromUrl } from "./artifacts.js";
import { parseMarkdownToItems, saveChangelog } from "./changelog.js";
import type { Arch, Channel, Platform } from "../types.js";

const FETCH_TIMEOUT_MS = 15_000;
const PER_PAGE = 100;

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  download_count: number;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  assets: GitHubAsset[];
}

/** 에셋 파일명 → 플랫폼 추정. 매칭 실패한 에셋은 임포트에서 건너뛴다. */
const PLATFORM_PATTERNS: [RegExp, Platform][] = [
  [/\.(exe|msi)$/i, "windows"],
  [/\.(dmg|pkg)$/i, "macos"],
  [/\.(appimage|deb|rpm)$/i, "linux"],
];

const ARCH_PATTERNS: [RegExp, Arch][] = [
  [/(arm64|aarch64)/i, "arm64"],
  [/universal/i, "universal"],
  [/(x64|x86_64|amd64|win32)/i, "x64"],
];

export function detectPlatform(fileName: string): Platform | null {
  return PLATFORM_PATTERNS.find(([re]) => re.test(fileName))?.[1] ?? null;
}

export function detectArch(fileName: string): Arch {
  return ARCH_PATTERNS.find(([re]) => re.test(fileName))?.[1] ?? "x64";
}

export function githubConfig(): { owner: string; repo: string; token: string | undefined } {
  return {
    owner: optionalEnv("GITHUB_OWNER") ?? "dwander",
    repo: optionalEnv("GITHUB_REPO") ?? "picell-releases",
    token: optionalEnv("GITHUB_TOKEN"),
  };
}

export function isGithubConfigured(): boolean {
  const { owner, repo } = githubConfig();
  return Boolean(owner && repo);
}

function apiHeaders(): Record<string, string> {
  const { token } = githubConfig();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "picell-update-server",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** 에셋 바이트를 받을 때 쓰는 헤더 — private 레포도 이 조합이면 받아진다. */
function assetHeaders(): Record<string, string> {
  return { ...apiHeaders(), Accept: "application/octet-stream" };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: apiHeaders(), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 레포의 릴리즈 목록(draft 제외, 최신순). */
export async function listGitHubReleases(): Promise<GitHubRelease[]> {
  const { owner, repo } = githubConfig();
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${PER_PAGE}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new ReleaseError(`GitHub API 오류: ${res.status} ${res.statusText}`, 502);
  }
  const rows = (await res.json()) as GitHubRelease[];
  return rows.filter((r) => !r.draft);
}

export interface ImportPreviewEntry {
  tagName: string;
  version: string;
  name: string;
  channel: Channel;
  publishedAt: string;
  alreadyImported: boolean;
  assets: {
    name: string;
    size: number;
    url: string;
    platform: Platform | null;
    arch: Arch;
  }[];
}

/** 임포트 전 미리보기 — 무엇이 어떻게 분류될지 관리자가 먼저 확인한다. */
export async function previewImport(): Promise<ImportPreviewEntry[]> {
  const rows = await listGitHubReleases();
  return rows
    .filter((r) => isValidVersion(normalizeVersion(r.tag_name)))
    .map((r) => {
      const version = normalizeVersion(r.tag_name);
      return {
        tagName: r.tag_name,
        version,
        name: r.name || r.tag_name,
        channel: (r.prerelease || isPrerelease(version) ? "beta" : "stable") as Channel,
        publishedAt: r.published_at,
        alreadyImported: Boolean(getReleaseRowByVersion(version)),
        assets: r.assets.map((a) => ({
          name: a.name,
          size: a.size,
          url: a.browser_download_url,
          platform: detectPlatform(a.name),
          arch: detectArch(a.name),
        })),
      };
    });
}

export interface ImportResult {
  version: string;
  created: boolean;
  importedAssets: number;
  skippedAssets: string[];
  error: string | null;
}

/**
 * 릴리즈 하나를 가져온다. 이미 있는 버전은 건드리지 않는다(덮어쓰기로 운영 중인
 * 릴리즈를 망가뜨리지 않도록). 임포트 결과는 draft로 들어오고, 발행은 사람이 한다.
 */
export async function importRelease(tagName: string): Promise<ImportResult> {
  const releases = await listGitHubReleases();
  const gh = releases.find((r) => r.tag_name === tagName);
  if (!gh) throw new ReleaseError(`GitHub에서 태그를 찾을 수 없습니다: ${tagName}`, 404);

  const version = normalizeVersion(gh.tag_name);
  if (!isValidVersion(version)) {
    throw new ReleaseError(`semver로 해석할 수 없는 태그입니다: ${tagName}`);
  }

  const result: ImportResult = {
    version,
    created: false,
    importedAssets: 0,
    skippedAssets: [],
    error: null,
  };

  let releaseId = getReleaseRowByVersion(version)?.id;
  if (!releaseId) {
    const channel: Channel = gh.prerelease || isPrerelease(version) ? "beta" : "stable";
    const created = createRelease({
      version,
      channel,
      name: gh.name || `PiCell One ${version}`,
    });
    releaseId = created.id;
    result.created = true;

    // 릴리즈 본문은 원문 그대로 보존하고, 항목 파싱은 부가 정보로만 채운다.
    const body = gh.body ?? "";
    saveChangelog(releaseId, "ko", {
      bodyMarkdown: body,
      items: parseMarkdownToItems(body),
    });
  }

  for (const asset of gh.assets) {
    const platform = detectPlatform(asset.name);
    if (!platform) {
      result.skippedAssets.push(asset.name);
      continue;
    }
    try {
      await importFromUrl(
        {
          releaseId,
          url: asset.browser_download_url,
          fileName: asset.name,
          platform,
          arch: detectArch(asset.name),
        },
        assetHeaders(),
      );
      result.importedAssets++;
    } catch (e) {
      result.skippedAssets.push(asset.name);
      result.error = e instanceof Error ? e.message : String(e);
    }
  }

  return result;
}
