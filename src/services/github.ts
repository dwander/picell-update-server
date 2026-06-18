import type { GitHubRelease, ReleaseInfo, AssetInfo, Platform } from "../types.js";

const GITHUB_OWNER = process.env.GITHUB_OWNER || "dwander";
const GITHUB_REPO = process.env.GITHUB_REPO || "picell-releases";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5분
const FETCH_TIMEOUT_MS = 8_000; // GitHub API 요청 타임아웃
const STALE_RETRY_MS = 30 * 1000; // 페치 실패 후 GitHub 재시도 보류 간격

/** 플랫폼별 에셋 파일 패턴 */
const PLATFORM_PATTERNS: Record<Platform, RegExp> = {
  windows: /\.exe$/i,
};

let cachedRelease: ReleaseInfo | null = null;
let cachedAt = 0;
let cachedBetaRelease: ReleaseInfo | null = null;
let cachedBetaAt = 0;

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

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: apiHeaders(), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const res = await fetchWithTimeout(url);

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as GitHubRelease;
}

async function fetchLatestPreRelease(): Promise<GitHubRelease | null> {
  // per_page=100으로 충분히 가져와 정식 릴리즈가 많이 쌓여도 베타를 놓치지 않도록 함
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=100`;
  const res = await fetchWithTimeout(url);

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const releases = (await res.json()) as GitHubRelease[];
  return releases.find((r) => r.prerelease) ?? null;
}

function parseVersion(tagName: string): string {
  return tagName.replace(/^v/, "");
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
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
    prerelease: release.prerelease,
    assets: assetMap,
  };
}

/** 최신 안정 릴리즈 정보 (캐싱 적용) */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  const now = Date.now();

  if (cachedRelease && now - cachedAt < CACHE_TTL_MS) {
    return cachedRelease;
  }

  try {
    const release = await fetchLatestRelease();
    cachedRelease = toReleaseInfo(release);
    cachedAt = now;
    return cachedRelease;
  } catch (e) {
    // GitHub 호출 실패(레이트 리밋 등) — 만료된 캐시라도 있으면 502 대신 그것을 반환
    if (cachedRelease) {
      console.warn("GitHub fetch failed, serving stale release cache:", e);
      // 짧은 시간 재시도 보류 → 레이트 리밋 상태에서 GitHub를 매 요청마다 두드리지 않음
      cachedAt = now - CACHE_TTL_MS + STALE_RETRY_MS;
      return cachedRelease;
    }
    throw e;
  }
}

/** 최신 베타(pre-release) 릴리즈 정보 (캐싱 적용)
 *  안정 버전이 베타보다 높으면 안정 버전을 반환 */
export async function getLatestBetaRelease(): Promise<ReleaseInfo | null> {
  const now = Date.now();

  if (cachedBetaRelease && now - cachedBetaAt < CACHE_TTL_MS) {
    return cachedBetaRelease;
  }

  try {
    const [betaRelease, stableRelease] = await Promise.all([
      fetchLatestPreRelease(),
      fetchLatestRelease(),
    ]);

    const beta = betaRelease ? toReleaseInfo(betaRelease) : null;
    const stable = toReleaseInfo(stableRelease);

    // 베타가 없거나 안정 버전이 더 높으면 안정 버전 반환
    const result =
      !beta || compareVersions(stable.version, beta.version) > 0 ? stable : beta;

    cachedBetaRelease = result;
    cachedBetaAt = now;

    return cachedBetaRelease;
  } catch (e) {
    // GitHub 호출 실패(레이트 리밋 등) — 만료된 캐시라도 있으면 502 대신 그것을 반환
    if (cachedBetaRelease) {
      console.warn("GitHub fetch failed, serving stale beta cache:", e);
      cachedBetaAt = now - CACHE_TTL_MS + STALE_RETRY_MS;
      return cachedBetaRelease;
    }
    throw e;
  }
}

/** 캐시 강제 무효화 */
export function invalidateCache(): void {
  cachedRelease = null;
  cachedAt = 0;
  cachedBetaRelease = null;
  cachedBetaAt = 0;
}
