<script lang="ts">
  import { onMount } from "svelte";
  import { Download, HardDrive, MonitorSmartphone, Package } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { navigate, router } from "../lib/router.svelte.js";
  import { toasts } from "../lib/ui.svelte.js";
  import { formatBytes, formatDate, formatNumber } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import StatTile from "../components/StatTile.svelte";
  import BarChart from "../components/BarChart.svelte";
  import ReleaseBadges from "../components/ReleaseBadges.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Button from "../components/Button.svelte";
  import type { ReleaseSummaryDTO, StatsResponse } from "../../../src/types.js";

  const RECENT_LIMIT = 6;

  let releases = $state<ReleaseSummaryDTO[]>([]);
  let stats = $state<StatsResponse | null>(null);
  let storageBytes = $state<number | null>(null);
  let loading = $state(true);

  onMount(async () => {
    try {
      const [releaseRes, statsRes] = await Promise.all([api.listReleases(), api.stats()]);
      releases = releaseRes.releases;
      stats = statsRes;
      // 스토리지는 버킷 전체 리스팅이라 느릴 수 있어 별도로 뒤따라 채운다.
      const storage = await api.storage().catch(() => null);
      storageBytes = storage?.overview?.totalBytes ?? null;
    } catch (e) {
      toasts.error(e);
    } finally {
      loading = false;
    }
  });

  /** 채널별 현재 배포 중인 버전 — 발행된 것 중 최신(목록은 이미 버전 내림차순). */
  const liveStable = $derived(
    releases.find((r) => r.status === "published" && r.channel === "stable"),
  );
  const liveBeta = $derived(releases.find((r) => r.status === "published" && r.channel === "beta"));
  const drafts = $derived(releases.filter((r) => r.status === "draft"));
  const recent = $derived(releases.slice(0, RECENT_LIMIT));
  const daily = $derived(
    (stats?.daily ?? []).map((d) => ({ label: d.date.slice(5), value: d.count })),
  );
</script>

<header class="mb-5">
  <h1 class="text-lg font-semibold text-ink">대시보드</h1>
  <p class="mt-0.5 text-xs text-ink-faint">배포 현황 한눈에 보기</p>
</header>

{#if loading}
  <p class="py-16 text-center text-xs text-ink-faint">불러오는 중…</p>
{:else}
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <StatTile
      label="총 다운로드"
      value={stats?.total ?? 0}
      hint="최근 7일 {formatNumber(stats?.last7Days ?? 0)}건"
      icon={Download}
    />
    <StatTile
      label="활성 설치"
      value={stats?.activeInstalls ?? 0}
      hint="최근 14일 업데이트 확인 기준"
      icon={MonitorSmartphone}
    />
    <StatTile label="릴리즈" value={releases.length} hint="초안 {drafts.length}건" icon={Package} />
    <StatTile
      label="R2 사용량"
      value={storageBytes === null ? "—" : formatBytes(storageBytes)}
      hint="아티팩트 합계"
      icon={HardDrive}
    />
  </div>

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    {#each [{ label: "안정 채널", release: liveStable }, { label: "베타 채널", release: liveBeta }] as entry (entry.label)}
      <Card title={entry.label} subtitle="현재 배포 중">
        {#if entry.release}
          {@const r = entry.release}
          <div class="flex items-baseline gap-2">
            <a
              href={router.href(`/releases/${r.id}`)}
              onclick={(e) => navigate(e, `/releases/${r.id}`)}
              class="font-mono text-xl font-semibold text-accent hover:underline"
            >
              {r.version}
            </a>
            <span class="truncate text-xs text-ink-faint">{r.name}</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <ReleaseBadges
              channel={r.channel}
              status={r.status}
              mandatory={r.mandatory}
              rolloutPercent={r.rolloutPercent}
            />
          </div>
          {#if r.summary}
            <p class="mt-2 text-xs text-ink-muted">{r.summary}</p>
          {/if}
          <dl class="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-xs">
            <div>
              <dt class="text-ink-faint">발행</dt>
              <dd class="mt-0.5 text-ink-muted">{formatDate(r.publishedAt)}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">다운로드</dt>
              <dd class="mt-0.5 font-mono text-ink-muted">{formatNumber(r.downloadCount)}</dd>
            </div>
            <div>
              <dt class="text-ink-faint">용량</dt>
              <dd class="mt-0.5 font-mono text-ink-muted">{formatBytes(r.totalBytes)}</dd>
            </div>
          </dl>
        {:else}
          <EmptyState title="발행된 릴리즈가 없습니다." body="릴리즈를 만들고 발행하면 여기에 표시됩니다." />
        {/if}
      </Card>
    {/each}
  </div>

  <Card title="일별 다운로드" subtitle="최근 30일" class="mt-4">
    <BarChart data={daily} />
  </Card>

  <Card title="최근 릴리즈" class="mt-4" padded={false}>
    {#snippet actions()}
      <Button onclick={() => router.go("/releases")}>전체 보기</Button>
    {/snippet}
    {#if recent.length === 0}
      <EmptyState title="릴리즈가 없습니다." />
    {:else}
      <ul class="divide-y divide-line">
        {#each recent as r (r.id)}
          <li>
            <a
              href={router.href(`/releases/${r.id}`)}
              onclick={(e) => navigate(e, `/releases/${r.id}`)}
              class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
            >
              <span class="w-28 shrink-0 font-mono text-sm text-ink">{r.version}</span>
              <span class="flex shrink-0 flex-wrap gap-1">
                <ReleaseBadges channel={r.channel} status={r.status} mandatory={r.mandatory} />
              </span>
              <span class="min-w-0 flex-1 truncate text-xs text-ink-faint">
                {r.summary || r.name}
              </span>
              <span class="shrink-0 font-mono text-xs text-ink-muted">
                {formatNumber(r.downloadCount)}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
{/if}
