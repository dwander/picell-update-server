// 환경변수는 여기서만 읽는다. 각 모듈은 이 헬퍼로 값을 얻고, 빠진 값은 명확한
// 에러로 throw한다 (picell-works-cloud 규칙 2 승계).

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function numberEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function boolEnv(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (!v) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

/** 관리 콘솔 비밀번호. 구 STATS_PASSWORD를 폴백으로 받아 기존 배포가 잠기지 않게 한다. */
export function adminPassword(): string | undefined {
  return optionalEnv("ADMIN_PASSWORD") ?? optionalEnv("STATS_PASSWORD");
}

export const PORT = numberEnv("PORT", 3000);
export const DB_PATH = optionalEnv("DB_PATH") ?? "data.db";
/** 정적 SPA 산출물 경로 (vite build → dist/public) */
export const PUBLIC_DIR = optionalEnv("PUBLIC_DIR") ?? "dist/public";
