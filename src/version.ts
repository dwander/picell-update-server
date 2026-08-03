// semver 파싱·비교. 구 구현은 "1.2.0".split(".")만 다뤄 `1.2.0-beta.1` 같은
// 프리릴리즈 태그를 숫자로 못 읽고 NaN 비교로 무너졌다. 베타 채널을 정식으로
// 운영하려면 프리릴리즈 우선순위가 필수라 semver 규칙대로 다시 짰다.

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 프리릴리즈 식별자들. 비어 있으면 정식 릴리즈. */
  prerelease: (string | number)[];
  build: string | undefined;
  raw: string;
}

const SEMVER_RE =
  /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** 선행 `v`/공백을 털어낸 정규화 문자열. 저장·비교 전에 항상 통과시킨다. */
export function normalizeVersion(input: string): string {
  return input.trim().replace(/^[vV]/, "");
}

export function parseVersion(input: string): ParsedVersion | null {
  const raw = normalizeVersion(input);
  const m = SEMVER_RE.exec(raw);
  if (!m) return null;
  const [, major, minor, patch, pre, build] = m;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: patch ? Number(patch) : 0,
    prerelease: pre
      ? pre.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p))
      : [],
    build: build,
    raw,
  };
}

export function isValidVersion(input: string): boolean {
  return parseVersion(input) !== null;
}

export function isPrerelease(input: string): boolean {
  return (parseVersion(input)?.prerelease.length ?? 0) > 0;
}

function comparePrerelease(a: (string | number)[], b: (string | number)[]): number {
  // semver: 프리릴리즈가 없는 쪽이 더 높다.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    // 식별자 수가 적은 쪽이 낮다 (1.0.0-beta < 1.0.0-beta.1).
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    // 숫자 식별자는 항상 문자 식별자보다 낮다.
    if (xNum && !yNum) return -1;
    if (!xNum && yNum) return 1;
    if (xNum && yNum) return (x as number) - (y as number);
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

/** a > b 면 양수, a < b 면 음수, 같으면 0. 파싱 불가한 값은 최하위로 취급. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** 정렬 비교자 — 최신 버전이 앞으로. */
export function byVersionDesc(a: string, b: string): number {
  return compareVersions(b, a);
}
