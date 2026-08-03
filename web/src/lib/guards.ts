// 열거값 판별 가드. 서버 types.ts에도 같은 함수가 있지만 그쪽은 **값**이라
// web이 import하면 서버 번들이 클라이언트로 딸려온다 (규칙 10). 목록이 짧고
// 서버 타입과 함께 컴파일되므로 어긋나면 타입 체크가 잡아준다.

import type { Arch, Platform } from "../../../src/types.js";

const PLATFORMS: Platform[] = ["windows", "macos", "linux"];
const ARCHES: Arch[] = ["x64", "arm64", "universal"];

export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as string[]).includes(v);
}

export function isArch(v: unknown): v is Arch {
  return typeof v === "string" && (ARCHES as string[]).includes(v);
}
