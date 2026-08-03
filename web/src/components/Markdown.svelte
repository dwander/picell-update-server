<script lang="ts">
  import { marked } from "marked";

  interface Props {
    source: string;
    empty?: string;
  }

  let { source, empty = "내용이 없습니다." }: Props = $props();

  // 콘솔은 관리자 본인만 쓰고 입력원도 관리자 자신이라 sanitizer를 얹지 않는다.
  // 외부 입력을 렌더하게 되면 그때 DOMPurify를 반드시 끼워야 한다.
  const html = $derived(source.trim() ? (marked.parse(source, { async: false }) as string) : "");
</script>

{#if html}
  <div class="markdown text-sm">{@html html}</div>
{:else}
  <p class="text-xs text-ink-faint">{empty}</p>
{/if}
