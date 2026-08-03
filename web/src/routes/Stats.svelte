<script lang="ts">
  import { onMount } from "svelte";
  import { CalendarDays, Download, Hash, MonitorSmartphone } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { toasts } from "../lib/ui.svelte.js";
  import { formatNumber } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import StatTile from "../components/StatTile.svelte";
  import BarChart from "../components/BarChart.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import type { StatsResponse } from "../../../src/types.js";

  let stats = $state<StatsResponse | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      stats = await api.stats();
    } catch (e) {
      toasts.error(e);
    } finally {
      loading = false;
    }
  });

  const daily = $derived(
    (stats?.daily ?? []).map((d) => ({ label: d.date.slice(5), value: d.count })),
  );

  /** 막대 길이는 최댓값 기준 비율 — 상위 항목이 100%가 된다. */
  function ratio(count: number, rows: { count: number }[]): number {
    const max = Math.max(...rows.map((r) => r.count), 1);
    return (count / max) * 100;
  }
</script>

<header class="mb-5">
  <h1 class="text-lg font-semibold text-ink">통계</h1>
  <p class="mt-0.5 text-xs text-ink-faint">다운로드 이력과 설치 기반 현황</p>
</header>

{#if loading}
  <p class="py-16 text-center text-xs text-ink-faint">불러오는 중…</p>
{:else if stats}
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <StatTile label="총 다운로드" value={stats.total} icon={Download} />
    <StatTile label="고유 PC" value={stats.uniqueMachines} hint="machineId 기준" icon={Hash} />
    <StatTile
      label="최근 30일"
      value={stats.last30Days}
      hint="7일 {formatNumber(stats.last7Days)}건"
      icon={CalendarDays}
    />
    <StatTile
      label="활성 설치"
      value={stats.activeInstalls}
      hint="최근 14일 확인 기준"
      icon={MonitorSmartphone}
    />
  </div>

  <Card title="일별 다운로드" subtitle="최근 30일" class="mt-4">
    <BarChart data={daily} height={160} />
  </Card>

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    <Card title="버전별 다운로드">
      {#if stats.byVersion.length === 0}
        <EmptyState title="기록이 없습니다." />
      {:else}
        <ul class="space-y-1.5">
          {#each stats.byVersion as row (row.version)}
            <li class="flex items-center gap-3 text-xs">
              <span class="w-28 shrink-0 font-mono text-ink-muted">{row.version}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  class="block h-full rounded-full bg-accent"
                  style="width: {ratio(row.count, stats.byVersion)}%"
                ></span>
              </span>
              <span class="w-14 shrink-0 text-right font-mono text-ink-muted">
                {formatNumber(row.count)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <Card title="설치된 버전" subtitle="업데이트 확인 핑 기준 — 실제로 돌고 있는 버전">
      {#if stats.installsByVersion.length === 0}
        <EmptyState
          title="설치 기록이 없습니다."
          body="클라이언트가 machineId를 함께 보내면 집계됩니다."
        />
      {:else}
        <ul class="space-y-1.5">
          {#each stats.installsByVersion as row (row.version)}
            <li class="flex items-center gap-3 text-xs">
              <span class="w-28 shrink-0 font-mono text-ink-muted">{row.version}</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  class="block h-full rounded-full bg-ok"
                  style="width: {ratio(row.count, stats.installsByVersion)}%"
                ></span>
              </span>
              <span class="w-14 shrink-0 text-right font-mono text-ink-muted">
                {formatNumber(row.count)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <Card title="플랫폼별">
      {#if stats.byPlatform.length === 0}
        <EmptyState title="기록이 없습니다." />
      {:else}
        <table class="w-full text-xs">
          <tbody class="divide-y divide-line">
            {#each stats.byPlatform as row (row.platform)}
              <tr>
                <td class="py-1.5 text-ink-muted">{row.platform}</td>
                <td class="py-1.5 text-right font-mono text-ink-muted">
                  {formatNumber(row.count)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Card>

    <Card title="채널별">
      {#if stats.byChannel.length === 0}
        <EmptyState title="기록이 없습니다." />
      {:else}
        <table class="w-full text-xs">
          <tbody class="divide-y divide-line">
            {#each stats.byChannel as row (row.channel)}
              <tr>
                <td class="py-1.5 text-ink-muted">{row.channel === "beta" ? "베타" : "안정"}</td>
                <td class="py-1.5 text-right font-mono text-ink-muted">
                  {formatNumber(row.count)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </Card>
  </div>
{/if}
