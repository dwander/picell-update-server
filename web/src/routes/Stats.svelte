<script lang="ts">
  import { onMount } from "svelte";
  import {
    Activity,
    CalendarDays,
    Download,
    Hash,
    History,
    MonitorSmartphone,
    Settings,
    Trash2,
    Users,
  } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { toasts } from "../lib/ui.svelte.js";
  import { formatDate, formatDay, formatNumber, formatRelative } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import StatTile from "../components/StatTile.svelte";
  import BarChart from "../components/BarChart.svelte";
  import VersionBars from "../components/VersionBars.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Modal from "../components/Modal.svelte";
  import Button from "../components/Button.svelte";
  import Field from "../components/Field.svelte";
  import type { ActivityResponse, StatsResponse } from "../../../src/types.js";

  /** 서버의 DOWNLOAD_PRUNE_MAX_THRESHOLD와 같은 값 — 바꿀 때 함께 고칠 것. */
  const PRUNE_MAX_THRESHOLD = 100;

  const INPUT_CLASS =
    "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  let stats = $state<StatsResponse | null>(null);
  let activity = $state<ActivityResponse | null>(null);
  let loading = $state(true);

  let settingsOpen = $state(false);
  let pruneInput = $state<number | null>(1);
  let pruning = $state(false);

  async function load(): Promise<void> {
    try {
      const [statsRes, activityRes] = await Promise.all([api.stats(), api.activity()]);
      stats = statsRes;
      activity = activityRes;
    } catch (e) {
      toasts.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const daily = $derived(
    (stats?.daily ?? []).map((d) => ({ label: d.date.slice(5), value: d.count })),
  );
  const dailyActive = $derived(
    (stats?.dailyActiveUsers ?? []).map((d) => ({ label: d.date.slice(5), value: d.count })),
  );

  /**
   * 삭제 기준. 입력을 비우면 `null`이 들어오는데 그때 0으로 떨어뜨려 대상이 없게 만든다
   * (NaN이 비교에 섞여 전부 대상이 되는 사고를 막는다).
   */
  const threshold = $derived(
    Math.min(Math.max(Math.trunc(Number(pruneInput) || 0), 0), PRUNE_MAX_THRESHOLD),
  );
  /** 서버와 같은 기준(count <= threshold)을 화면에서 먼저 보여 준다. */
  const pruneTargets = $derived((stats?.byVersion ?? []).filter((r) => r.count <= threshold));
  const pruneRows = $derived(pruneTargets.reduce((sum, r) => sum + r.count, 0));

  async function runPrune(): Promise<void> {
    if (threshold < 1 || pruneTargets.length === 0) return;
    pruning = true;
    try {
      const result = await api.pruneDownloads(threshold);
      toasts.ok(
        `버전 ${result.versions.length}개 · 기록 ${formatNumber(result.deletedRows)}건을 지웠습니다.`,
      );
      settingsOpen = false;
      await load();
    } catch (e) {
      toasts.error(e);
    } finally {
      pruning = false;
    }
  }

  /** machineId는 길어서 표를 밀어낸다. 앞부분만 보이고 전체는 툴팁으로 준다. */
  function shortMachineId(id: string): string {
    return id.length > 16 ? `${id.slice(0, 16)}…` : id;
  }
</script>

<header class="mb-5 flex items-start justify-between gap-4">
  <div>
    <h1 class="text-lg font-semibold text-ink">통계</h1>
    <p class="mt-0.5 text-xs text-ink-faint">활성 사용자와 다운로드 이력</p>
  </div>
  <Button onclick={() => (settingsOpen = true)} disabled={!stats} title="통계 정리">
    <Settings size={13} />설정
  </Button>
</header>

{#if loading}
  <p class="py-16 text-center text-xs text-ink-faint">불러오는 중…</p>
{:else if stats}
  <!-- ─── 활성 사용자 ─────────────────────────────────────────────────────── -->

  <h2 class="mb-2 text-sm font-semibold text-ink">활성 사용자</h2>
  <p class="mb-3 text-xs text-ink-faint">
    업데이트 확인(<span class="font-mono">/update/check</span>)이 남긴 영구 로그 기준 — 같은 PC를
    하루에 몇 번 확인해도 하루 1대로 셉니다.
  </p>

  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <StatTile
      label="오늘 활성"
      value={stats.activeUsers.today}
      hint="UTC 기준 오늘"
      icon={Activity}
    />
    <StatTile
      label="최근 7일"
      value={stats.activeUsers.last7Days}
      hint="주간 활성 PC"
      icon={Users}
    />
    <StatTile
      label="최근 30일"
      value={stats.activeUsers.last30Days}
      hint="월간 활성 PC"
      icon={CalendarDays}
    />
    <StatTile
      label="누적 PC"
      value={stats.activeUsers.allTime}
      hint="로그에 한 번이라도 남은 PC"
      icon={MonitorSmartphone}
    />
  </div>

  <Card title="일별 활성 PC" subtitle="최근 30일 · 그날 업데이트 확인을 보낸 고유 PC" class="mt-4">
    <BarChart data={dailyActive} height={160} />
  </Card>

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    <Card title="활성 PC의 버전" subtitle="최근 30일 활성 PC가 현재 쓰고 있는 버전">
      {#if stats.activeByVersion.length === 0}
        <EmptyState title="활성 기록이 없습니다." />
      {:else}
        <VersionBars rows={stats.activeByVersion} />
      {/if}
    </Card>

    <Card title="설치된 버전" subtitle="확인을 보낸 적 있는 모든 PC — 오래 안 켠 PC도 포함">
      {#if stats.installsByVersion.length === 0}
        <EmptyState
          title="설치 기록이 없습니다."
          body="클라이언트가 machineId를 함께 보내면 집계됩니다."
        />
      {:else}
        <VersionBars rows={stats.installsByVersion} tone="ok" />
      {/if}
    </Card>
  </div>

  <Card
    title="PC별 활동 기록"
    subtitle={activity
      ? `최근 확인 순 · 전체 ${formatNumber(activity.totalMachines)}대 중 ${formatNumber(activity.machines.length)}대 표시`
      : "최근 확인 순"}
    class="mt-4"
    padded={false}
  >
    {#if !activity || activity.machines.length === 0}
      <EmptyState
        title="업데이트 확인 기록이 없습니다."
        body={"클라이언트가 /update/check에 machineId와 version을 보내면 여기에 쌓입니다.\nmachineId 없이 온 확인은 어느 PC인지 알 수 없어 집계하지 않습니다."}
      />
    {:else}
      <div class="max-h-[28rem] overflow-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-surface-1">
            <tr class="border-b border-line text-left text-xs text-ink-faint">
              <th class="px-4 py-2 font-medium">PC (machineId)</th>
              <th class="px-4 py-2 font-medium">버전</th>
              <th class="px-4 py-2 font-medium">플랫폼</th>
              <th class="px-4 py-2 text-right font-medium">활동일<br />({activity.windowDays}일)</th>
              <th class="px-4 py-2 text-right font-medium">확인</th>
              <th class="px-4 py-2 font-medium">최초</th>
              <th class="px-4 py-2 font-medium">최근</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            {#each activity.machines as m (m.machineId)}
              <tr>
                <td class="px-4 py-2 font-mono text-xs text-ink-muted" title={m.machineId}>
                  <span class="inline-flex items-center gap-1">
                    <History size={11} />{shortMachineId(m.machineId)}
                  </span>
                </td>
                <td class="px-4 py-2 font-mono text-xs whitespace-nowrap text-ink">
                  {m.version}
                  {#if m.channel === "beta"}
                    <span class="ml-1 text-ink-faint">베타</span>
                  {/if}
                </td>
                <td class="px-4 py-2 text-xs whitespace-nowrap text-ink-muted">
                  {m.platform}{m.arch ? ` · ${m.arch}` : ""}
                </td>
                <td class="px-4 py-2 text-right font-mono text-xs text-ink-muted">
                  {formatNumber(m.activeDays)}
                </td>
                <td
                  class="px-4 py-2 text-right font-mono text-xs text-ink-faint"
                  title="누적 업데이트 확인 횟수"
                >
                  {formatNumber(m.checkCount)}
                </td>
                <td
                  class="px-4 py-2 text-xs whitespace-nowrap text-ink-faint"
                  title={formatDate(m.firstSeenAt)}
                >
                  {formatDay(m.firstSeenAt)}
                </td>
                <td
                  class="px-4 py-2 text-xs whitespace-nowrap text-ink-muted"
                  title={formatDate(m.lastSeenAt)}
                >
                  {formatRelative(m.lastSeenAt)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </Card>

  <!-- ─── 다운로드 ────────────────────────────────────────────────────────── -->

  <h2 class="mt-8 mb-2 text-sm font-semibold text-ink">다운로드</h2>
  <p class="mb-3 text-xs text-ink-faint">
    설치 파일 요청 이력 — 같은 PC가 같은 버전을 다시 받아도 한 번만 셉니다.
  </p>

  <div class="grid grid-cols-2 gap-3 lg:grid-cols-3">
    <StatTile label="총 다운로드" value={stats.total} icon={Download} />
    <StatTile label="고유 PC" value={stats.uniqueMachines} hint="machineId 기준" icon={Hash} />
    <StatTile
      label="최근 30일"
      value={stats.last30Days}
      hint="7일 {formatNumber(stats.last7Days)}건"
      icon={CalendarDays}
    />
  </div>

  <Card title="일별 다운로드" subtitle="최근 30일" class="mt-4">
    <BarChart data={daily} height={160} />
  </Card>

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    <Card
      title="버전별 다운로드"
      subtitle={stats.byVersion.length > 0 ? `${stats.byVersion.length}개 버전` : undefined}
    >
      {#if stats.byVersion.length === 0}
        <EmptyState title="기록이 없습니다." />
      {:else}
        <VersionBars rows={stats.byVersion} />
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

<!-- ─── 통계 정리 ──────────────────────────────────────────────────────────────
     지운 대상을 미리 보여 주는 것이 이 팝업의 존재 이유다. 별도 확인 창을 겹치지
     않고 목록 + danger 버튼으로 끝낸다. -->

<Modal title="통계 정리" open={settingsOpen} onclose={() => (settingsOpen = false)}>
  <div class="space-y-3">
    <p class="text-xs whitespace-pre-line text-ink-faint">
      {"다운로드 수가 기준 이하인 버전의 기록을 지웁니다.\n실사용자가 붙기 전에 직접 눌러 본 기록이 버전 목록을 채울 때 씁니다."}
    </p>

    <Field
      label="기준 다운로드 수"
      hint={`이 값 이하인 버전이 삭제 대상입니다. 최대 ${PRUNE_MAX_THRESHOLD}.`}
    >
      <input
        type="number"
        min="1"
        max={PRUNE_MAX_THRESHOLD}
        bind:value={pruneInput}
        class="{INPUT_CLASS} font-mono"
      />
    </Field>

    {#if pruneTargets.length === 0}
      <p class="rounded-lg border border-line bg-surface-0 px-3 py-2 text-xs text-ink-faint">
        {threshold < 1
          ? "기준을 1 이상으로 입력하세요."
          : `다운로드 ${threshold}건 이하인 버전이 없습니다.`}
      </p>
    {:else}
      <div class="rounded-lg border border-line bg-surface-0">
        <p class="border-b border-line px-3 py-2 text-xs text-ink-muted">
          삭제 대상 {pruneTargets.length}개 버전 · 기록 {formatNumber(pruneRows)}건
          <span class="text-ink-faint">
            (남는 버전 {(stats?.byVersion.length ?? 0) - pruneTargets.length}개)
          </span>
        </p>
        <ul class="max-h-48 space-y-1 overflow-y-auto p-2">
          {#each pruneTargets as row (row.version)}
            <li class="flex items-center justify-between gap-3 px-1 text-xs">
              <span class="font-mono text-ink-muted">{row.version}</span>
              <span class="font-mono text-danger">{formatNumber(row.count)}건</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <p class="text-xs whitespace-pre-line text-ink-faint">
      {"되돌릴 수 없습니다. 활성 사용자·설치 버전 통계는 그대로 남습니다.\n지운 뒤 같은 PC가 그 버전을 다시 받으면 새로 1건으로 잡힙니다."}
    </p>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (settingsOpen = false)}>취소</Button>
    <Button
      variant="danger"
      loading={pruning}
      disabled={pruneTargets.length === 0}
      onclick={runPrune}
    >
      <Trash2 size={13} />{pruneTargets.length > 0
        ? `${pruneTargets.length}개 버전 삭제`
        : "삭제"}
    </Button>
  {/snippet}
</Modal>
