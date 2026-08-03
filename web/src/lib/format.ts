// 표시용 포매터 (순수 함수). 서버 I/O 모듈과 섞지 않는다 (규칙 10).

import type { ChangelogType, Channel, ReleaseStatus } from "../../../src/types.js";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  return `${value.toFixed(exp === 0 ? 0 : value >= 100 ? 0 : 1)} ${BYTE_UNITS[exp]}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}일 전`;
  return formatDay(iso);
}

export function formatNumber(n: number): string {
  return n.toLocaleString("ko-KR");
}

/** 색만으로 구분하지 않도록 라벨을 항상 함께 쓴다 (규칙 16). */
export const STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: "초안",
  published: "발행됨",
  archived: "철회됨",
};

export const CHANNEL_LABELS: Record<Channel, string> = {
  stable: "안정",
  beta: "베타",
};

export const CHANGELOG_TYPE_LABELS: Record<ChangelogType, string> = {
  added: "추가",
  improved: "개선",
  changed: "변경",
  fixed: "수정",
  removed: "삭제",
  security: "보안",
};

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "—";
}
