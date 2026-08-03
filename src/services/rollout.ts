// 단계적 배포(rollout) 판정.
//
// machineId를 버전과 함께 해시해 0~99 버킷에 결정론적으로 배치한다. 같은 PC는
// 같은 버전에 대해 항상 같은 판정을 받으므로, 업데이트가 보였다 사라지는 일이 없다.
// 버전을 해시에 섞는 이유: 버전마다 대상 집합이 달라져 특정 PC가 매 릴리즈 초기
// 배포에서 계속 제외되거나 계속 포함되는 편향을 없애기 위함.

import { createHash } from "node:crypto";

const BUCKETS = 100;

export function rolloutBucket(machineId: string, version: string): number {
  const digest = createHash("sha256").update(`${machineId}:${version}`).digest();
  return digest.readUInt32BE(0) % BUCKETS;
}

/**
 * 이 클라이언트가 배포 대상인지.
 * machineId가 없으면 결정론적 판정이 불가능하므로 100% 배포일 때만 포함한다
 * (요청마다 결과가 달라져 업데이트가 깜빡이는 것보다 보수적인 쪽이 낫다).
 */
export function isInRollout(
  rolloutPercent: number,
  version: string,
  machineId: string | undefined,
): boolean {
  if (rolloutPercent >= BUCKETS) return true;
  if (rolloutPercent <= 0) return false;
  if (!machineId) return false;
  return rolloutBucket(machineId, version) < rolloutPercent;
}
