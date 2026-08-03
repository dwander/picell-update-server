// 체인지로그 도메인 — 항목(구조화) ↔ 마크다운(자유 서식) 양방향 관리.
//
// 릴리즈 노트를 GitHub 릴리즈 본문에 평문으로 두면 항목 단위 재사용(요약 배지,
// 누적 변경 목록, 로케일 분리)이 불가능하다. 그래서 항목을 1차 데이터로 두고
// 마크다운은 파생물로 생성하되, 직접 쓴 마크다운이 있으면 그것을 우선한다.

import { db, newId } from "../db/index.js";
import { changelogs, changelogItems } from "../db/schema.js";
import { and, asc, eq } from "drizzle-orm";
import {
  CHANGELOG_TYPES,
  type ChangelogDTO,
  type ChangelogItemDTO,
  type ChangelogType,
  type Locale,
} from "../types.js";

/** 마크다운 섹션 제목. CHANGELOG_TYPES 순서대로 출력된다. */
const TYPE_LABELS: Record<Locale, Record<ChangelogType, string>> = {
  ko: {
    added: "추가",
    improved: "개선",
    changed: "변경",
    fixed: "수정",
    removed: "삭제",
    security: "보안",
  },
  en: {
    added: "Added",
    improved: "Improved",
    changed: "Changed",
    fixed: "Fixed",
    removed: "Removed",
    security: "Security",
  },
};

export function typeLabel(type: ChangelogType, locale: Locale): string {
  return TYPE_LABELS[locale][type];
}

/** 항목 목록 → 마크다운. 타입별로 묶어 표준 순서로 섹션을 만든다. */
export function itemsToMarkdown(
  items: { type: ChangelogType; text: string }[],
  locale: Locale,
): string {
  const sections: string[] = [];
  for (const type of CHANGELOG_TYPES) {
    const rows = items.filter((i) => i.type === type && i.text.trim());
    if (rows.length === 0) continue;
    sections.push(
      `### ${TYPE_LABELS[locale][type]}\n${rows.map((r) => `- ${r.text.trim()}`).join("\n")}`,
    );
  }
  return sections.join("\n\n");
}

/** 클라이언트에 나갈 최종 노트. 직접 쓴 마크다운 > 항목 생성본. */
export function renderNotes(
  bodyMarkdown: string,
  items: { type: ChangelogType; text: string }[],
  locale: Locale,
): string {
  const body = bodyMarkdown.trim();
  return body || itemsToMarkdown(items, locale);
}

// ─── 조회 ────────────────────────────────────────────────────────────────────

export function getItems(releaseId: string, locale: Locale): ChangelogItemDTO[] {
  return db
    .select()
    .from(changelogItems)
    .where(and(eq(changelogItems.releaseId, releaseId), eq(changelogItems.locale, locale)))
    .orderBy(asc(changelogItems.sortOrder))
    .all()
    .map((r) => ({
      id: r.id,
      type: r.type as ChangelogType,
      text: r.text,
      sortOrder: r.sortOrder,
    }));
}

export function getChangelog(releaseId: string, locale: Locale): ChangelogDTO {
  const row = db
    .select()
    .from(changelogs)
    .where(and(eq(changelogs.releaseId, releaseId), eq(changelogs.locale, locale)))
    .get();
  const items = getItems(releaseId, locale);
  const summary = row?.summary ?? "";
  const bodyMarkdown = row?.bodyMarkdown ?? "";
  return {
    locale,
    summary,
    bodyMarkdown,
    items,
    rendered: renderNotes(bodyMarkdown, items, locale),
    updatedAt: row?.updatedAt?.toISOString() ?? null,
  };
}

// ─── 저장 ────────────────────────────────────────────────────────────────────

export interface ChangelogInput {
  summary?: string;
  bodyMarkdown?: string;
  items?: { type: ChangelogType; text: string }[];
}

/** 로케일 하나를 통째로 교체 저장. 항목은 전달 순서가 곧 정렬 순서. */
export function saveChangelog(
  releaseId: string,
  locale: Locale,
  input: ChangelogInput,
): ChangelogDTO {
  const existing = db
    .select()
    .from(changelogs)
    .where(and(eq(changelogs.releaseId, releaseId), eq(changelogs.locale, locale)))
    .get();

  const summary = input.summary ?? existing?.summary ?? "";
  const bodyMarkdown = input.bodyMarkdown ?? existing?.bodyMarkdown ?? "";

  if (existing) {
    db.update(changelogs)
      .set({ summary, bodyMarkdown, updatedAt: new Date() })
      .where(eq(changelogs.id, existing.id))
      .run();
  } else {
    db.insert(changelogs)
      .values({ id: newId(), releaseId, locale, summary, bodyMarkdown, updatedAt: new Date() })
      .run();
  }

  if (input.items) {
    db.delete(changelogItems)
      .where(and(eq(changelogItems.releaseId, releaseId), eq(changelogItems.locale, locale)))
      .run();
    const rows = input.items
      .filter((i) => i.text.trim())
      .map((i, idx) => ({
        id: newId(),
        releaseId,
        locale,
        type: i.type,
        text: i.text.trim(),
        sortOrder: idx,
      }));
    if (rows.length > 0) db.insert(changelogItems).values(rows).run();
  }

  return getChangelog(releaseId, locale);
}

export function deleteChangelogs(releaseId: string): void {
  db.delete(changelogs).where(eq(changelogs.releaseId, releaseId)).run();
  db.delete(changelogItems).where(eq(changelogItems.releaseId, releaseId)).run();
}

/**
 * 마크다운 릴리즈 노트를 항목으로 역파싱한다 (GitHub 임포트용).
 * `### 섹션` / `- 항목` 형태만 인식한다. 섹션 제목은 한/영 라벨을 모두 받아준다.
 * 파싱이 부실할 수 있으므로 호출자는 원문 마크다운도 함께 보존해야 한다.
 */
export function parseMarkdownToItems(
  markdown: string,
): { type: ChangelogType; text: string }[] {
  const labelToType = new Map<string, ChangelogType>();
  for (const loc of Object.keys(TYPE_LABELS) as Locale[]) {
    for (const type of CHANGELOG_TYPES) {
      labelToType.set(TYPE_LABELS[loc][type].toLowerCase(), type);
    }
  }
  const DEFAULT_TYPE: ChangelogType = "changed";
  let current: ChangelogType = DEFAULT_TYPE;
  const out: { type: ChangelogType; text: string }[] = [];

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading?.[1]) {
      const key = heading[1].replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();
      current = labelToType.get(key) ?? DEFAULT_TYPE;
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet?.[1]) {
      const text = bullet[1].trim();
      if (text) out.push({ type: current, text });
    }
  }
  return out;
}
