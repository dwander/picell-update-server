<script lang="ts">
  import { formatNumber } from "../lib/format.js";

  interface Props {
    data: { label: string; value: number }[];
    height?: number;
  }

  let { data, height = 128 }: Props = $props();

  const max = $derived(Math.max(...data.map((d) => d.value), 1));
  const total = $derived(data.reduce((sum, d) => sum + d.value, 0));
</script>

{#if total === 0}
  <p class="py-8 text-center text-xs text-ink-faint">기간 내 기록이 없습니다.</p>
{:else}
  <div class="flex items-end gap-[2px]" style="height: {height}px">
    {#each data as d (d.label)}
      <div
        class="group relative flex-1 rounded-t-sm bg-accent/35 transition-colors hover:bg-accent"
        style="height: {Math.max((d.value / max) * 100, d.value > 0 ? 4 : 1)}%"
      >
        <span
          class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-xs whitespace-nowrap text-ink group-hover:block"
        >
          {d.label} · {formatNumber(d.value)}
        </span>
      </div>
    {/each}
  </div>
  <div class="mt-1.5 flex justify-between text-xs text-ink-faint">
    <span>{data[0]?.label ?? ""}</span>
    <span>{data[data.length - 1]?.label ?? ""}</span>
  </div>
{/if}
