// 마크다운 전처리 (순수 함수). 서버 I/O 모듈과 섞지 않는다 (규칙 10).

/**
 * `· 세부 항목` 줄을 하위 목록으로 바꾼다.
 *
 * 앱 changelog.txt는 항목에 딸린 설명을 가운뎃점으로 적는데, 마크다운에는 그런
 * 불릿 문자가 없어 그대로 두면 앞 항목에 이어붙은 한 문단이 된다(들여쓰기·줄바꿈
 * 모두 사라진다). 두 칸 들여쓴 `- `로 바꿔 중첩 리스트로 만든다.
 *
 * 서버는 renderNotes에서 같은 변환을 한다(src/services/changelog.ts).
 * 콘솔은 저장 전 초안도 그려야 해서 여기 사본이 필요하다 — 한쪽을 고치면 같이 고칠 것.
 */
const SUB_BULLET_RE = /^\s*[·•∙◦・‧]\s*(.+)$/;

export function normalizeSubBullets(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const sub = SUB_BULLET_RE.exec(line);
      return sub?.[1] ? `  - ${sub[1].trim()}` : line;
    })
    .join("\n");
}
