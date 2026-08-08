// changelog.txt 파서 — PiCell One 앱이 쓰는 형식을 그대로 읽는다.
//
//   # 주석
//   ## [0.5.33] 2026-07-18
//   ### 개선
//   - 항목
//     - 항목에 딸린 세부 설명 (가운뎃점으로 적기도 한다)
//   ### 새 기능
//   - 항목
//
// 릴리즈마다 노트를 손으로 옮겨 적는 대신 이 파일 하나를 올려 일괄 반영한다.
// 카테고리 제목은 자유 문자열이라 우리 타입 6종에 없는 것도 온다(설정·UI·성능 등).
// 그래서 **항목 파싱은 best-effort로 두고 원문 마크다운도 함께 보존**한다 —
// 클라이언트에는 원문이 나가고(bodyMarkdown 우선), 항목은 배지·구조화 용도로 쓴다.

import { isValidVersion, normalizeVersion } from "../version.js";
import type { ChangelogType } from "../types.js";

/** 개발 중 버전을 가리키는 예약어. 실제 릴리즈에 매칭하지 않는다. */
export const LATEST_MARKER = "latest";

/**
 * 카테고리 제목 → 항목 타입. 앞에서부터 먼저 맞는 것을 쓴다.
 * 매칭 안 되는 제목(설정·UI·전체화면 뷰어 등)은 DEFAULT_TYPE으로 떨어지되,
 * 원문 마크다운에는 제목이 그대로 남으므로 정보가 사라지지는 않는다.
 */
const CATEGORY_TYPES: [RegExp, ChangelogType][] = [
  [/^(새\s*기능|신규\s*기능|신기능|추가|added|new|features?)/i, "added"],
  [/^(버그\s*수정|오류\s*수정|수정|fixed?|bug\s*fixes?)/i, "fixed"],
  [/^(개선|향상|성능|improved?|enhancements?|performance)/i, "improved"],
  [/^(변경|changed?|changes)/i, "changed"],
  [/^(삭제|제거|removed?|deprecated)/i, "removed"],
  [/^(보안|security)/i, "security"],
];

const DEFAULT_TYPE: ChangelogType = "changed";

const VERSION_HEADING_RE = /^##\s*\[([^\]]+)\]\s*(.*)$/;
const CATEGORY_HEADING_RE = /^###\s*(.+)$/;
const BULLET_RE = /^[-*+]\s+(.+)$/;
/** 항목에 딸린 세부 설명. 앱은 가운뎃점으로 적는다. */
const SUB_BULLET_RE = /^[·•∙◦・‧]\s*(.+)$/;
/** 들여쓴 줄. 불릿이든 가운뎃점이든 앞 항목에 딸린 세부 설명으로 본다. */
const INDENTED_RE = /^[ \t]+\S/;

export function categoryToType(category: string): ChangelogType {
  const key = category.trim();
  return CATEGORY_TYPES.find(([re]) => re.test(key))?.[1] ?? DEFAULT_TYPE;
}

export interface ParsedChangelogVersion {
  /** 헤딩에 적힌 원문 (`0.5.33` 또는 `latest`) */
  rawVersion: string;
  /** 정규화된 semver. latest이거나 해석 불가면 null. */
  version: string | null;
  date: string | null;
  isLatest: boolean;
  items: { type: ChangelogType; text: string }[];
  /** 카테고리 구조를 유지한 마크다운. 클라이언트에 나가는 본문. */
  markdown: string;
}

/**
 * 파일 전체를 버전 블록으로 쪼갠다.
 * BOM·주석·빈 줄은 흘려보내고, 인식하는 세 가지 줄(버전 헤딩·카테고리·불릿)만 읽는다.
 */
export function parseChangelogFile(text: string): ParsedChangelogVersion[] {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out: ParsedChangelogVersion[] = [];

  let current: ParsedChangelogVersion | null = null;
  let currentCategory: string | null = null;
  let currentType: ChangelogType = DEFAULT_TYPE;
  /** 마크다운 재구성용 — 카테고리별 불릿 모음 */
  let sections: { title: string | null; lines: string[] }[] = [];

  const flush = (): void => {
    if (!current) return;
    current.markdown = sections
      .filter((s) => s.lines.length > 0)
      .map((s) => (s.title ? `### ${s.title}\n${s.lines.join("\n")}` : s.lines.join("\n")))
      .join("\n\n");
    out.push(current);
    current = null;
    sections = [];
  };

  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();

    const versionHeading = VERSION_HEADING_RE.exec(line);
    if (versionHeading?.[1]) {
      flush();
      const rawVersion = versionHeading[1].trim();
      const isLatest = rawVersion.toLowerCase() === LATEST_MARKER;
      const normalized = normalizeVersion(rawVersion);
      current = {
        rawVersion,
        version: !isLatest && isValidVersion(normalized) ? normalized : null,
        date: versionHeading[2]?.trim() || null,
        isLatest,
        items: [],
        markdown: "",
      };
      currentCategory = null;
      currentType = DEFAULT_TYPE;
      sections = [{ title: null, lines: [] }];
      continue;
    }

    if (!current) continue; // 파일 상단 제목·주석

    const categoryHeading = CATEGORY_HEADING_RE.exec(line);
    if (categoryHeading?.[1]) {
      currentCategory = categoryHeading[1].trim();
      currentType = categoryToType(currentCategory);
      sections.push({ title: currentCategory, lines: [] });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet?.[1]) {
      const itemText = bullet[1].trim();
      if (!itemText) continue;
      const section = sections[sections.length - 1];
      // 들여쓴 불릿은 새 항목이 아니라 바로 위 항목의 세부 설명이다. 가운뎃점과 같은
      // 취급으로 하위 목록에 넣는다 — 두 단계 이상 들여써도 한 단계로 눕힌다
      // (클라이언트가 받는 노트는 한 단계 중첩까지만 쓴다).
      // 앞선 항목이 없으면(섹션 첫 줄부터 들여쓴 경우) 상위 항목으로 받아 흘리지 않는다.
      if (INDENTED_RE.test(rawLine) && section && section.lines.length > 0) {
        section.lines.push(`  - ${itemText}`);
        continue;
      }
      current.items.push({ type: currentType, text: itemText });
      if (section) section.lines.push(`- ${itemText}`);
      continue;
    }

    // 세부 설명은 마크다운에만 원문 그대로 남긴다. 항목(items)은 배지·요약용이라
    // 상위 불릿만 담고, 렌더 시 renderNotes가 하위 목록으로 바꾼다.
    const subBullet = SUB_BULLET_RE.exec(line);
    if (subBullet?.[1]) {
      const section = sections[sections.length - 1];
      if (section) section.lines.push(`· ${subBullet[1].trim()}`);
    }
  }
  flush();

  return out;
}

/** 실제 릴리즈에 반영할 수 있는 항목만 (latest·해석 불가 제외). */
export function importableVersions(
  parsed: ParsedChangelogVersion[],
): (ParsedChangelogVersion & { version: string })[] {
  return parsed.filter((p): p is ParsedChangelogVersion & { version: string } =>
    Boolean(p.version),
  );
}
