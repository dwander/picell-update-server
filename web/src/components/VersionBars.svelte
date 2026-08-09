<script lang="ts">
  // 버전별 분포 막대 목록. 통계 화면에서 세 번(다운로드·활성 PC·설치) 같은 모양으로
  // 쓰이고, 버전이 쌓이면 세 카드가 함께 길어지므로 높이 제한도 한곳에 둔다.
  import { formatNumber } from "../lib/format.js";

  interface Props {
    rows: { version: string; count: number }[];
    tone?: "accent" | "ok";
    /**
     * 목록이 이 높이를 넘으면 카드를 늘리지 않고 안에서 스크롤한다.
     * 행 높이(22px)의 배수를 살짝 넘겨 잡아 마지막 행이 반쯤 잘려 보이게 한다 —
     * 스크롤바를 겹쳐 그리는 환경에서도 "더 있다"는 신호가 남는다.
     */
    maxHeight?: number;
  }

  let { rows, tone = "accent", maxHeight = 252 }: Props = $props();

  /** 막대 길이는 최댓값 기준 비율 — 상위 항목이 100%가 된다. */
  const max = $derived(Math.max(...rows.map((r) => r.count), 1));
</script>

<ul class="space-y-1.5 overflow-y-auto pr-1" style="max-height: {maxHeight}px">
  {#each rows as row (row.version)}
    <li class="flex items-center gap-3 text-xs">
      <span class="w-28 shrink-0 font-mono text-ink-muted">{row.version}</span>
      <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          class="block h-full rounded-full {tone === 'ok' ? 'bg-ok' : 'bg-accent'}"
          style="width: {(row.count / max) * 100}%"
        ></span>
      </span>
      <span class="w-14 shrink-0 text-right font-mono text-ink-muted">
        {formatNumber(row.count)}
      </span>
    </li>
  {/each}
</ul>
