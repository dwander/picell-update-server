<script lang="ts">
  import { onMount } from "svelte";
  import { Plus } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { navigate, router } from "../lib/router.svelte.js";
  import { toasts } from "../lib/ui.svelte.js";
  import { formatBytes, formatDate, formatNumber } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Modal from "../components/Modal.svelte";
  import Field from "../components/Field.svelte";
  import ReleaseBadges from "../components/ReleaseBadges.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import type { Channel, ReleaseStatus, ReleaseSummaryDTO } from "../../../src/types.js";

  const FILTERS: { value: ReleaseStatus | "all"; label: string }[] = [
    { value: "all", label: "전체" },
    { value: "published", label: "발행됨" },
    { value: "draft", label: "초안" },
    { value: "archived", label: "철회됨" },
  ];

  const INPUT_CLASS =
    "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  let releases = $state<ReleaseSummaryDTO[]>([]);
  let loading = $state(true);
  let filter = $state<ReleaseStatus | "all">("all");

  let creating = $state(false);
  let busy = $state(false);
  let form = $state({ version: "", channel: "stable" as Channel, name: "" });

  async function load(): Promise<void> {
    loading = true;
    try {
      releases = (await api.listReleases()).releases;
    } catch (e) {
      toasts.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function create(): Promise<void> {
    if (!form.version.trim() || busy) return;
    busy = true;
    try {
      const input: Parameters<typeof api.createRelease>[0] = {
        version: form.version.trim(),
        channel: form.channel,
      };
      if (form.name.trim()) input.name = form.name.trim();
      const { release } = await api.createRelease(input);
      toasts.ok(`릴리즈 ${release.version}을(를) 만들었습니다.`);
      creating = false;
      form = { version: "", channel: "stable", name: "" };
      router.go(`/releases/${release.id}`);
    } catch (e) {
      toasts.error(e);
    } finally {
      busy = false;
    }
  }

  const filtered = $derived(
    filter === "all" ? releases : releases.filter((r) => r.status === filter),
  );
</script>

<header class="mb-5 flex items-start justify-between gap-4">
  <div>
    <h1 class="text-lg font-semibold text-ink">릴리즈</h1>
    <p class="mt-0.5 text-xs text-ink-faint">버전별 아티팩트와 배포 상태를 관리합니다.</p>
  </div>
  <Button variant="primary" onclick={() => (creating = true)}>
    <Plus size={14} />새 릴리즈
  </Button>
</header>

<div class="mb-3 flex gap-1">
  {#each FILTERS as f (f.value)}
    <button
      type="button"
      class="rounded-lg px-3 py-1.5 text-xs transition-colors {filter === f.value
        ? 'bg-surface-3 font-medium text-ink'
        : 'text-ink-faint hover:text-ink-muted'}"
      onclick={() => (filter = f.value)}
    >
      {f.label}
      <span class="ml-1 font-mono text-ink-faint">
        {f.value === "all" ? releases.length : releases.filter((r) => r.status === f.value).length}
      </span>
    </button>
  {/each}
</div>

<Card padded={false}>
  {#if loading}
    <p class="py-16 text-center text-xs text-ink-faint">불러오는 중…</p>
  {:else if filtered.length === 0}
    <EmptyState
      title="릴리즈가 없습니다."
      body="새 릴리즈를 만들어 바이너리를 업로드하고 체인지로그를 작성하세요."
    />
  {:else}
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-line text-left text-xs text-ink-faint">
          <th class="px-4 py-2 font-medium">버전</th>
          <th class="px-4 py-2 font-medium">상태</th>
          <th class="px-4 py-2 font-medium">요약</th>
          <th class="px-4 py-2 text-right font-medium">아티팩트</th>
          <th class="px-4 py-2 text-right font-medium">다운로드</th>
          <th class="px-4 py-2 text-right font-medium">발행일</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        {#each filtered as r (r.id)}
          <tr
            class="cursor-pointer transition-colors hover:bg-surface-2"
            onclick={() => router.go(`/releases/${r.id}`)}
          >
            <td class="px-4 py-2.5">
              <a
                href={router.href(`/releases/${r.id}`)}
                onclick={(e) => navigate(e, `/releases/${r.id}`)}
                class="font-mono text-ink hover:text-accent"
              >
                {r.version}
              </a>
            </td>
            <td class="px-4 py-2.5">
              <span class="flex flex-wrap gap-1">
                <ReleaseBadges
                  channel={r.channel}
                  status={r.status}
                  mandatory={r.mandatory}
                  rolloutPercent={r.rolloutPercent}
                />
              </span>
            </td>
            <td class="max-w-xs truncate px-4 py-2.5 text-xs text-ink-muted">
              {r.summary || r.name}
            </td>
            <td class="px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
              {r.artifactCount}
              <span class="text-ink-faint">· {formatBytes(r.totalBytes)}</span>
            </td>
            <td class="px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
              {formatNumber(r.downloadCount)}
            </td>
            <td class="px-4 py-2.5 text-right text-xs text-ink-faint">
              {formatDate(r.publishedAt)}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Card>

<Modal title="새 릴리즈" open={creating} onclose={() => (creating = false)}>
  <div class="space-y-3">
    <Field label="버전" hint="semver 형식. 예: 1.4.0 또는 1.4.0-beta.1">
      <input
        bind:value={form.version}
        placeholder="1.4.0"
        class="{INPUT_CLASS} font-mono"
      />
    </Field>
    <Field label="채널">
      <select bind:value={form.channel} class={INPUT_CLASS}>
        <option value="stable">안정</option>
        <option value="beta">베타</option>
      </select>
    </Field>
    <Field label="표시 이름" hint="비워두면 'PiCell One {form.version || '1.4.0'}'으로 채워집니다.">
      <input bind:value={form.name} placeholder="PiCell One 1.4.0" class={INPUT_CLASS} />
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (creating = false)}>취소</Button>
    <Button variant="primary" loading={busy} onclick={create}>만들기</Button>
  {/snippet}
</Modal>
