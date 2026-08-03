// 네이티브 바인딩 보증 — npm이 **옵셔널** 의존성 설치에 실패하면 조용히 건너뛰는
// 버그(npm/cli#4828) 방어.
//
// vite 8의 번들러 rolldown은 플랫폼별 네이티브 바인딩(리눅스 x64 기준 19MB)을
// optionalDependencies로 받는다. CI에서 이 다운로드가 실패하면 npm은 경고 하나 없이
// 설치 성공으로 끝내고, 빌드 시점에야 "Cannot find native binding"으로 죽는다.
// (실제로 Railway 빌드가 이렇게 실패했다 — npm ci가 175/177개만 설치했다.)
//
// 그래서 빌드 직전에 바인딩 존재를 직접 확인하고, 없으면 명시적으로 한 번 더 받는다.
// 이때는 옵셔널이 아니므로 실패하면 빌드가 여기서 멈춘다 — 조용한 실패보다 낫다.

import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

/** 현재 플랫폼에 맞는 rolldown 바인딩 패키지 이름. rolldown의 명명 규칙을 따른다. */
function bindingNameFor(platform, arch) {
  if (platform === "win32") return `@rolldown/binding-win32-${arch}-msvc`;
  if (platform === "darwin") return `@rolldown/binding-darwin-${arch}`;
  if (platform === "linux") {
    // musl(Alpine 등)과 glibc는 바이너리가 다르다. Node가 보고하는 런타임 glibc
    // 버전이 없으면 musl로 판단한다.
    const isGlibc = Boolean(process.report?.getReport()?.header?.glibcVersionRuntime);
    const suffix = arch === "arm" ? "-gnueabihf" : isGlibc ? "-gnu" : "-musl";
    return `@rolldown/binding-linux-${arch}${suffix}`;
  }
  return null;
}

function resolvable(name) {
  try {
    require.resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
}

const name = bindingNameFor(process.platform, process.arch);
if (!name) {
  console.log(`[native-deps] ${process.platform}/${process.arch}는 확인 대상이 아님 — 통과`);
  process.exit(0);
}

if (resolvable(name)) {
  console.log(`[native-deps] ${name} 확인됨`);
  process.exit(0);
}

// rolldown 본체 버전에 맞춰 받아야 ABI가 어긋나지 않는다.
const version = require("rolldown/package.json").version;
console.warn(`[native-deps] ${name} 누락 — ${version} 버전으로 직접 설치합니다.`);

try {
  execFileSync("npm", ["install", "--no-save", "--include=optional", `${name}@${version}`], {
    stdio: "inherit",
  });
} catch {
  console.error(`[native-deps] ${name}@${version} 설치 실패 — 빌드를 중단합니다.`);
  process.exit(1);
}

if (!resolvable(name)) {
  console.error(`[native-deps] 설치 후에도 ${name}을(를) 찾을 수 없습니다 — 빌드를 중단합니다.`);
  process.exit(1);
}
console.log(`[native-deps] ${name} 복구 완료`);
