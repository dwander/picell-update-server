// 파일명에서 릴리즈 정보를 유추한다.
//
// 릴리즈를 만들 때마다 버전·표시 이름·플랫폼을 손으로 적는 건 낭비다. 배포 파일명에
// 이미 다 들어 있다: `PiCell One-0.5.33-Setup.exe` → 0.5.33 / "PiCell One" / windows.
//
// GitHub 임포트와 콘솔 업로드가 같은 규칙을 써야 하므로(규칙 6) 추론 로직을 여기
// 한 곳에 모으고, github.ts와 artifacts.ts는 이 모듈을 가져다 쓴다.

import { isValidVersion, normalizeVersion } from "../version.js";
import type { Arch, ArtifactKind, Channel, Platform } from "../types.js";

/** 에셋 파일명 → 플랫폼. 매칭 실패는 null(임포트에서 건너뛴다). */
const PLATFORM_PATTERNS: [RegExp, Platform][] = [
  [/\.(exe|msi)$/i, "windows"],
  [/\.(dmg|pkg)$/i, "macos"],
  [/\.(appimage|deb|rpm)$/i, "linux"],
];

const ARCH_PATTERNS: [RegExp, Arch][] = [
  [/(arm64|aarch64)/i, "arm64"],
  [/universal/i, "universal"],
  [/(x64|x86[_-]?64|amd64|win32|ia32)/i, "x64"],
];

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

/**
 * 버전 토큰. 프리릴리즈 꼬리표는 **알려진 단어만** 인정한다.
 * 그러지 않으면 `PiCell One-0.5.33-Setup.exe`의 `-Setup`이 프리릴리즈로 잡혀
 * `0.5.33-Setup`이라는 엉뚱한 버전이 나온다.
 */
const VERSION_RE =
  /(?:^|[-_ vV])(\d+\.\d+(?:\.\d+)?)(?:-((?:alpha|beta|rc|pre|preview|dev|canary|next|snapshot)(?:[.-]?\d+)?))?/;

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function detectPlatform(fileName: string): Platform | null {
  return PLATFORM_PATTERNS.find(([re]) => re.test(fileName))?.[1] ?? null;
}

/** 에셋 파일명 → 아키텍처. 토큰이 없으면 null(호출자가 기본값을 정한다). */
export function detectArch(fileName: string): Arch | null {
  return ARCH_PATTERNS.find(([re]) => re.test(fileName))?.[1] ?? null;
}

export function guessKind(fileName: string): ArtifactKind {
  return KIND_BY_EXTENSION[extensionOf(fileName)] ?? "other";
}

export function guessContentType(fileName: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extensionOf(fileName)] ?? "application/octet-stream";
}

export interface InspectedFileName {
  fileName: string;
  version: string | null;
  /** 프리릴리즈 태그가 붙어 있으면 beta로 제안한다. */
  channel: Channel;
  /** 버전 앞부분에서 뽑은 제품명. 못 뽑으면 null. */
  productName: string | null;
  /** 릴리즈 표시 이름 제안. 제품명이 없으면 null(서버 기본값에 맡긴다). */
  suggestedName: string | null;
  platform: Platform | null;
  /** 파일명에 아키텍처 토큰이 없으면 null — 기본값 결정은 호출자 몫이다. */
  arch: Arch | null;
  kind: ArtifactKind;
}

/** 파일명 앞부분을 사람이 읽는 제품명으로 정리한다. */
function cleanProductName(raw: string): string | null {
  const name = raw
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || null;
}

export function inspectFileName(fileName: string): InspectedFileName {
  const withoutExt = fileName.replace(/\.[^.]+$/, "");
  const match = VERSION_RE.exec(withoutExt);

  let version: string | null = null;
  let productName: string | null = null;

  if (match?.[1]) {
    const candidate = normalizeVersion(match[2] ? `${match[1]}-${match[2]}` : match[1]);
    if (isValidVersion(candidate)) {
      version = candidate;
      productName = cleanProductName(withoutExt.slice(0, match.index));
    }
  }

  return {
    fileName,
    version,
    channel: match?.[2] ? "beta" : "stable",
    productName,
    suggestedName: version && productName ? `${productName} ${version}` : null,
    platform: detectPlatform(fileName),
    arch: detectArch(fileName),
    kind: guessKind(fileName),
  };
}
