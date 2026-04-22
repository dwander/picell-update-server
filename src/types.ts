export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  prerelease: boolean;
  published_at: string;
  assets: GitHubAsset[];
}

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  download_count: number;
}

export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  prerelease: boolean;
  assets: Record<string, AssetInfo>;
}

export interface AssetInfo {
  url: string;
  fileName: string;
  size: number;
}

export type Platform = "windows";
