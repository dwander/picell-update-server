<script lang="ts">
  import { marked } from "marked";
  import { normalizeSubBullets } from "../lib/markdown.js";

  interface Props {
    source: string;
    empty?: string;
  }

  let { source, empty = "내용이 없습니다." }: Props = $props();

  // 콘솔은 관리자 본인만 쓰고 입력원도 관리자 자신이라 sanitizer를 얹지 않는다.
  // 외부 입력을 렌더하게 되면 그때 DOMPurify를 반드시 끼워야 한다.
  // 서버가 이미 정규화해 보낸 값(rendered)도 있지만, 편집 중 초안은 원문 그대로라
  // 여기서 한 번 더 통과시킨다. 이미 변환된 줄은 그대로 지나간다(멱등).
  const html = $derived(
    source.trim() ? (marked.parse(normalizeSubBullets(source), { async: false }) as string) : "",
  );
</script>

{#if html}
  <div class="markdown text-sm">{@html html}</div>
{:else}
  <p class="text-xs text-ink-faint">{empty}</p>
{/if}
