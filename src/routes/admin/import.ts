// 자동 채우기 도구 — 손으로 적던 값을 파일에서 유추한다.
//   1) 설치 파일명 → 버전·표시 이름·플랫폼
//   2) changelog.txt → 버전별 릴리즈 노트 (릴리즈 편집 화면이 자기 버전만 골라 쓴다)
//
// 파싱만 하고 쓰기는 하지 않는다. 반영은 사람이 편집기에서 확인한 뒤
// PUT /releases/:id/changelog/:locale로 저장하는 경로 하나뿐이다.

import { Hono } from "hono";
import { ReleaseError, getReleaseRowByVersion } from "../../services/releases.js";
import { inspectFileName } from "../../services/artifact-naming.js";
import { parseChangelogFile } from "../../services/changelog-import.js";
import { handle, readJson, requireString } from "../helpers.js";
import { isLocale, type ChangelogImportEntryDTO, type Locale } from "../../types.js";

/** 파일 하나가 통째로 JSON 본문에 실려 온다. 방어적 상한. */
const MAX_CHANGELOG_CHARS = 2_000_000;

export const importRouter = new Hono();

/** POST /admin/api/inspect/filename — 릴리즈 생성 폼 자동 채우기 */
importRouter.post("/inspect/filename", (c) =>
  handle(c, async () => {
    const body = await readJson<{ fileName?: unknown }>(c);
    const fileName = requireString(body.fileName, "fileName");
    const inspected = inspectFileName(fileName);
    return {
      ...inspected,
      // 이미 있는 버전이면 폼에서 바로 알려준다(중복 생성 시도 방지).
      existingReleaseId: inspected.version
        ? (getReleaseRowByVersion(inspected.version)?.id ?? null)
        : null,
    };
  }),
);

function buildEntries(text: string): ChangelogImportEntryDTO[] {
  if (text.length > MAX_CHANGELOG_CHARS) {
    throw new ReleaseError("체인지로그 파일이 너무 큽니다.");
  }
  const parsed = parseChangelogFile(text);
  if (parsed.length === 0) {
    throw new ReleaseError(
      "인식할 수 있는 버전 항목이 없습니다. '## [0.5.33] 2026-07-18' 형식의 헤딩이 필요합니다.",
    );
  }

  return parsed.map((entry) => {
    const release = entry.version ? getReleaseRowByVersion(entry.version) : undefined;
    return {
      rawVersion: entry.rawVersion,
      version: entry.version,
      date: entry.date,
      isLatest: entry.isLatest,
      itemCount: entry.items.length,
      markdown: entry.markdown,
      items: entry.items,
      releaseId: release?.id ?? null,
      releaseName: release?.name ?? null,
    };
  });
}

/** POST /admin/api/changelog/parse — 버전 블록으로 갈라 돌려준다 (쓰기 없음) */
importRouter.post("/changelog/parse", (c) =>
  handle(c, async () => {
    const body = await readJson<{ text?: unknown; locale?: unknown }>(c);
    const text = requireString(body.text, "text");
    const locale: Locale = isLocale(body.locale) ? body.locale : "ko";
    const entries = buildEntries(text);
    return {
      locale,
      entries,
      matched: entries.filter((e) => e.releaseId).length,
      unmatched: entries.filter((e) => !e.releaseId && !e.isLatest).length,
    };
  }),
);
