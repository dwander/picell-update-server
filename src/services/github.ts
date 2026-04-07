import type { GitHubRelease, ReleaseInfo, AssetInfo, Platform } from "../types.js";

const GITHUB_OWNER = process.env.GITHUB_OWNER || "dwander";
const GITHUB_REPO = process.env.GITHUB_REPO || "picell-releases";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5분

/** 플랫폼별 에셋 파일 패턴 */
const PLATFORM_PATTERNS: Record<Platform, RegExp> = {
  windows: /\.exe$/i,
};

let cachedRelease: ReleaseInfo | null = null;
let cachedAt = 0;

function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "picell-update-server",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const res = await fetch(url, { headers: apiHeaders() });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as GitHubRelease;
}

function parseVersion(tagName: string): string {
  return tagName.replace(/^v/, "");
}

function matchAsset(
  assets: GitHubRelease["assets"],
  platform: Platform
): AssetInfo | null {
  const pattern = PLATFORM_PATTERNS[platform];
  const asset = assets.find((a) => pattern.test(a.name));
  if (!asset) return null;

  return {
    url: asset.browser_download_url,
    fileName: asset.name,
    size: asset.size,
  };
}

function toReleaseInfo(release: GitHubRelease): ReleaseInfo {
  const assetMap: Record<string, AssetInfo> = {};

  for (const platform of Object.keys(PLATFORM_PATTERNS) as Platform[]) {
    const asset = matchAsset(release.assets, platform);
    if (asset) {
      assetMap[platform] = asset;
    }
  }

  return {
    version: parseVersion(release.tag_name),
    name: release.name || release.tag_name,
    notes: release.body || "",
    publishedAt: release.published_at,
    assets: assetMap,
  };
}

/** 최신 릴리즈 정보 (캐싱 적용) */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  const now = Date.now();

  if (cachedRelease && now - cachedAt < CACHE_TTL_MS) {
    return cachedRelease;
  }

  const release = await fetchLatestRelease();
  cachedRelease = toReleaseInfo(release);
  cachedAt = now;

  return cachedRelease;
}

/** 캐시 강제 무효화 */
export function invalidateCache(): void {
  cachedRelease = null;
  cachedAt = 0;
}
