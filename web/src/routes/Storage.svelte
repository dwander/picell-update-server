<script lang="ts">
  import { onMount } from "svelte";
  import { TriangleAlert, HardDrive, RefreshCw, Trash2, Unlink } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { confirms, toasts } from "../lib/ui.svelte.js";
  import { formatBytes, formatDate } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Badge from "../components/Badge.svelte";
  import StatTile from "../components/StatTile.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import type { StorageOverviewDTO } from "../../../src/types.js";

  let overview = $state<StorageOverviewDTO | null>(null);
  let configured = $state(true);
  let loading = $state(true);
  let selected = $state<Set<string>>(new Set());
  let onlyOrphans = $state(false);

  async function load(): Promise<void> {
    loading = true;
    selected = new Set();
    try {
      const res = await api.storage();
      configured = res.configured;
      overview = res.overview;
    } catch (e) {
      toasts.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function toggle(key: string): void {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  }

  function selectAllOrphans(): void {
    selected = new Set(orphans.map((o) => o.key));
  }

  async function cleanup(): Promise<void> {
    if (selected.size === 0) return;
    const ok = await confirms.ask(
      "고아 오브젝트 삭제",
      `선택한 ${selected.size}개 오브젝트를 R2에서 영구 삭제합니다.\n릴리즈에 연결된 파일은 서버가 다시 검사해 건너뜁니다.`,
      { confirmLabel: "삭제", danger: true },
    );
    if (!ok) return;

    try {
      const result = await api.cleanupStorage([...selected]);
      toasts.ok(
        `${result.deleted.length}개 삭제${result.skipped.length ? `, ${result.skipped.length}개 건너뜀` : ""}`,
      );
      await load();
    } catch (e) {
      toasts.error(e);
    }
  }

  const objects = $derived(overview?.objects ?? []);
  const orphans = $derived(objects.filter((o) => !o.linked));
  const visible = $derived(onlyOrphans ? orphans : objects);
</script>

<header class="mb-5 flex items-start justify-between gap-4">
  <div>
    <h1 class="text-lg font-semibold text-ink">스토리지</h1>
    <p class="mt-0.5 text-xs text-ink-faint">
      {#if overview}
        R2 {overview.bucket}{overview.prefix ? ` · ${overview.prefix}` : ""} 버킷의 releases/ 하위
      {:else}
        R2 버킷 점검
      {/if}
    </p>
  </div>
  <Button onclick={load} loading={loading}><RefreshCw size={13} />다시 스캔</Button>
</header>

{#if !configured}
  <Card>
    <EmptyState
      title="R2 스토리지가 설정되지 않았습니다."
      body={"STORAGE_ENDPOINT / STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY / STORAGE_BUCKET을\nRailway 환경변수에 설정한 뒤 다시 배포하세요."}
    />
  </Card>
{:else if loading}
  <p class="py-16 text-center text-xs text-ink-faint">버킷을 스캔하는 중…</p>
{:else if overview}
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <StatTile label="오브젝트" value={overview.objectCount} icon={HardDrive} />
    <StatTile label="사용량" value={formatBytes(overview.totalBytes)} />
    <StatTile
      label="고아 오브젝트"
      value={overview.orphanCount}
      hint={formatBytes(overview.orphanBytes)}
      icon={Unlink}
    />
    <StatTile
      label="누락 파일"
      value={overview.missingCount}
      hint="DB엔 있으나 R2에 없음"
      icon={TriangleAlert}
    />
  </div>

  {#if overview.missing.length > 0}
    <Card title="누락된 아티팩트" subtitle="업로드가 끝나지 않은 항목 — 발행 전에 재업로드가 필요합니다." class="mt-4">
      <ul class="space-y-1 text-xs">
        {#each overview.missing as m (m.artifactId)}
          <li class="flex gap-3">
            <span class="w-24 shrink-0 font-mono text-ink-muted">{m.version}</span>
            <span class="truncate font-mono text-danger">{m.storageKey}</span>
          </li>
        {/each}
      </ul>
    </Card>
  {/if}

  <Card class="mt-4" padded={false}>
    {#snippet actions()}
      <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
        <input
          type="checkbox"
          bind:checked={onlyOrphans}
          class="size-3.5 rounded border-line bg-surface-0 accent-accent"
        />
        고아만 보기
      </label>
      <Button onclick={selectAllOrphans} disabled={orphans.length === 0}>
        고아 전체 선택
      </Button>
      <Button variant="danger" onclick={cleanup} disabled={selected.size === 0}>
        <Trash2 size={13} />선택 삭제 ({selected.size})
      </Button>
    {/snippet}

    {#if visible.length === 0}
      <EmptyState title={onlyOrphans ? "고아 오브젝트가 없습니다." : "오브젝트가 없습니다."} />
    {:else}
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-line text-left text-xs text-ink-faint">
            <th class="w-8 px-4 py-2"></th>
            <th class="px-4 py-2 font-medium">키</th>
            <th class="px-4 py-2 font-medium">연결</th>
            <th class="px-4 py-2 text-right font-medium">크기</th>
            <th class="px-4 py-2 text-right font-medium">수정</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          {#each visible as obj (obj.key)}
            <tr class:bg-surface-2={selected.has(obj.key)}>
              <td class="px-4 py-2">
                <input
                  type="checkbox"
                  aria-label="{obj.key} 선택"
                  checked={selected.has(obj.key)}
                  onchange={() => toggle(obj.key)}
                  class="size-3.5 rounded border-line bg-surface-0 accent-accent"
                />
              </td>
              <td class="max-w-md truncate px-4 py-2 font-mono text-xs text-ink-muted">
                {obj.key}
              </td>
              <td class="px-4 py-2">
                {#if obj.linked}
                  <Badge tone="ok">{obj.releaseVersion ?? "연결됨"}</Badge>
                {:else}
                  <Badge tone="warn"><Unlink size={11} />고아</Badge>
                {/if}
              </td>
              <td class="px-4 py-2 text-right font-mono text-xs text-ink-muted">
                {formatBytes(obj.size)}
              </td>
              <td class="px-4 py-2 text-right text-xs text-ink-faint">
                {formatDate(obj.lastModified)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </Card>
{/if}
