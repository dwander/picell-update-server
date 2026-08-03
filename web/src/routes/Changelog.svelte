<script lang="ts">
  import { onMount } from "svelte";
  import { Copy } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { navigate, router } from "../lib/router.svelte.js";
  import { toasts } from "../lib/ui.svelte.js";
  import { formatDay } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Markdown from "../components/Markdown.svelte";
  import ReleaseBadges from "../components/ReleaseBadges.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import type { ChangelogDTO, Channel, Locale, ReleaseStatus } from "../../../src/types.js";

  interface Entry {
    id: string;
    version: string;
    channel: Channel;
    name: string;
    status: ReleaseStatus;
    publishedAt: string | null;
    changelog: ChangelogDTO;
  }

  const LOCALES: { value: Locale; label: string }[] = [
    { value: "ko", label: "한국어" },
    { value: "en", label: "English" },
  ];

  let entries = $state<Entry[]>([]);
  let locale = $state<Locale>("ko");
  let publishedOnly = $state(true);
  let loading = $state(true);

  async function load(): Promise<void> {
    loading = true;
    try {
      entries = (await api.changelogTimeline(locale)).entries;
    } catch (e) {
      toasts.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(load);

  const visible = $derived(publishedOnly ? entries.filter((e) => e.status === "published") : entries);

  /** CHANGELOG.md 형태로 통째 복사 — 릴리즈 노트를 다른 채널에 옮길 때 쓴다. */
  async function copyAll(): Promise<void> {
    const text = visible
      .map((e) => {
        const head = `## ${e.version}${e.publishedAt ? ` — ${formatDay(e.publishedAt)}` : ""}`;
        const summary = e.changelog.summary ? `\n${e.changelog.summary}\n` : "";
        return `${head}\n${summary}\n${e.changelog.rendered}`.trim();
      })
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text || "내용 없음");
      toasts.ok("체인지로그를 클립보드에 복사했습니다.");
    } catch {
      toasts.error("클립보드 접근이 거부되었습니다.");
    }
  }
</script>

<header class="mb-5 flex flex-wrap items-start justify-between gap-4">
  <div>
    <h1 class="text-lg font-semibold text-ink">체인지로그</h1>
    <p class="mt-0.5 text-xs text-ink-faint">전체 릴리즈 노트를 한 줄기로 봅니다.</p>
  </div>
  <div class="flex items-center gap-2">
    <div class="flex rounded-lg border border-line p-0.5">
      {#each LOCALES as l (l.value)}
        <button
          type="button"
          class="rounded-md px-2.5 py-1 text-xs transition-colors {locale === l.value
            ? 'bg-surface-3 font-medium text-ink'
            : 'text-ink-faint hover:text-ink-muted'}"
          onclick={() => {
            locale = l.value;
            void load();
          }}
        >
          {l.label}
        </button>
      {/each}
    </div>
    <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
      <input
        type="checkbox"
        bind:checked={publishedOnly}
        class="size-3.5 rounded border-line bg-surface-0 accent-accent"
      />
      발행된 것만
    </label>
    <Button onclick={copyAll}><Copy size={13} />전체 복사</Button>
  </div>
</header>

{#if loading}
  <p class="py-16 text-center text-xs text-ink-faint">불러오는 중…</p>
{:else if visible.length === 0}
  <Card><EmptyState title="표시할 체인지로그가 없습니다." /></Card>
{:else}
  <div class="space-y-3">
    {#each visible as entry (entry.id)}
      <Card padded={false}>
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b border-line px-4 py-3">
          <a
            href={router.href(`/releases/${entry.id}`)}
            onclick={(e) => navigate(e, `/releases/${entry.id}`)}
            class="font-mono text-sm font-semibold text-accent hover:underline"
          >
            {entry.version}
          </a>
          <span class="flex flex-wrap gap-1.5">
            <ReleaseBadges channel={entry.channel} status={entry.status} />
          </span>
          <span class="ml-auto text-xs text-ink-faint">{formatDay(entry.publishedAt)}</span>
        </div>
        <div class="px-4 py-3">
          {#if entry.changelog.summary}
            <p class="mb-2 text-sm font-medium text-ink">{entry.changelog.summary}</p>
          {/if}
          <Markdown source={entry.changelog.rendered} empty="릴리즈 노트가 작성되지 않았습니다." />
        </div>
      </Card>
    {/each}
  </div>
{/if}
