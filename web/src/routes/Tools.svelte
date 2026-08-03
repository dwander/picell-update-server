<script lang="ts">
  import { onMount } from "svelte";
  import { Download, GitBranch, ScrollText } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { confirms, toasts } from "../lib/ui.svelte.js";
  import { formatBytes, formatDate, formatDay } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Badge from "../components/Badge.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import type { Arch, Channel, Platform } from "../../../src/types.js";

  interface PreviewRelease {
    tagName: string;
    version: string;
    name: string;
    channel: Channel;
    publishedAt: string;
    alreadyImported: boolean;
    assets: { name: string; size: number; url: string; platform: Platform | null; arch: Arch }[];
  }

  let preview = $state<{ repo: string; tokenConfigured: boolean; releases: PreviewRelease[] } | null>(
    null,
  );
  let previewLoading = $state(false);
  let importingTag = $state<string | null>(null);

  let logs = $state<
    { id: number; action: string; target: string | null; detail: string | null; ip: string | null; createdAt: string }[]
  >([]);

  onMount(async () => {
    logs = (await api.auditLogs().catch(() => ({ logs: [] }))).logs;
  });

  async function loadPreview(): Promise<void> {
    previewLoading = true;
    try {
      preview = await api.githubPreview();
    } catch (e) {
      toasts.error(e);
    } finally {
      previewLoading = false;
    }
  }

  async function runImport(entry: PreviewRelease): Promise<void> {
    const importable = entry.assets.filter((a) => a.platform);
    const ok = await confirms.ask(
      "GitHub 릴리즈 가져오기",
      `${entry.tagName}의 에셋 ${importable.length}개를 R2로 복사합니다.\n용량에 따라 수 분이 걸릴 수 있습니다.\n가져온 릴리즈는 초안 상태로 들어옵니다.`,
      { confirmLabel: "가져오기" },
    );
    if (!ok) return;

    importingTag = entry.tagName;
    try {
      const result = await api.githubImport(entry.tagName);
      toasts.ok(
        `${result.version}: 에셋 ${result.importedAssets}개 가져옴${
          result.skippedAssets.length ? `, ${result.skippedAssets.length}개 건너뜀` : ""
        }`,
      );
      if (result.error) toasts.error(result.error);
      await loadPreview();
      logs = (await api.auditLogs()).logs;
    } catch (e) {
      toasts.error(e);
    } finally {
      importingTag = null;
    }
  }
</script>

<header class="mb-5">
  <h1 class="text-lg font-semibold text-ink">도구</h1>
  <p class="mt-0.5 text-xs text-ink-faint">이관 작업과 운영 기록</p>
</header>

<Card
  title="GitHub Releases 임포트"
  subtitle="과거 릴리즈를 R2로 옮기는 일회성 도구입니다. 서비스 자체는 GitHub에 의존하지 않습니다."
  class="mb-4"
  padded={false}
>
  {#snippet actions()}
    <Button onclick={loadPreview} loading={previewLoading}>
      <GitBranch size={13} />릴리즈 조회
    </Button>
  {/snippet}

  {#if !preview}
    <EmptyState
      title="GitHub 릴리즈를 조회해 보세요."
      body={"GITHUB_OWNER / GITHUB_REPO 레포의 릴리즈 목록을 읽어옵니다.\n비공개 레포이거나 레이트 리밋이 걱정되면 GITHUB_TOKEN을 설정하세요."}
    />
  {:else}
    <div class="flex items-center gap-2 border-b border-line px-4 py-2 text-xs">
      <span class="font-mono text-ink-muted">{preview.repo}</span>
      {#if preview.tokenConfigured}
        <Badge tone="ok">토큰 설정됨</Badge>
      {:else}
        <Badge tone="warn">토큰 없음 · 시간당 60회 제한</Badge>
      {/if}
    </div>

    {#if preview.releases.length === 0}
      <EmptyState title="가져올 릴리즈가 없습니다." />
    {:else}
      <ul class="divide-y divide-line">
        {#each preview.releases as entry (entry.tagName)}
          <li class="flex flex-wrap items-center gap-3 px-4 py-3">
            <span class="w-32 shrink-0 font-mono text-sm text-ink">{entry.version}</span>
            <span class="flex shrink-0 gap-1">
              {#if entry.channel === "beta"}
                <Badge tone="beta">베타</Badge>
              {:else}
                <Badge tone="neutral">안정</Badge>
              {/if}
              {#if entry.alreadyImported}
                <Badge tone="ok">가져옴</Badge>
              {/if}
            </span>
            <span class="min-w-0 flex-1 truncate text-xs text-ink-faint">
              {entry.assets.map((a) => a.name).join(", ") || "에셋 없음"}
            </span>
            <span class="shrink-0 text-xs text-ink-faint">{formatDay(entry.publishedAt)}</span>
            <Button
              onclick={() => runImport(entry)}
              loading={importingTag === entry.tagName}
              disabled={entry.alreadyImported || entry.assets.every((a) => !a.platform)}
            >
              <Download size={13} />가져오기
            </Button>
          </li>
          {#if entry.assets.some((a) => !a.platform)}
            <li class="px-4 pb-2 text-xs text-ink-faint">
              분류 불가로 건너뛸 에셋: {entry.assets
                .filter((a) => !a.platform)
                .map((a) => `${a.name} (${formatBytes(a.size)})`)
                .join(", ")}
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  {/if}
</Card>

<Card title="감사 로그" subtitle="발행·삭제 등 되돌리기 어려운 조작 기록" padded={false}>
  {#if logs.length === 0}
    <EmptyState title="기록이 없습니다." />
  {:else}
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-line text-left text-xs text-ink-faint">
          <th class="px-4 py-2 font-medium">시각</th>
          <th class="px-4 py-2 font-medium">작업</th>
          <th class="px-4 py-2 font-medium">대상</th>
          <th class="px-4 py-2 font-medium">상세</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        {#each logs as log (log.id)}
          <tr>
            <td class="px-4 py-2 text-xs whitespace-nowrap text-ink-faint">
              {formatDate(log.createdAt)}
            </td>
            <td class="px-4 py-2">
              <span class="inline-flex items-center gap-1 font-mono text-xs text-ink-muted">
                <ScrollText size={11} />{log.action}
              </span>
            </td>
            <td class="px-4 py-2 font-mono text-xs text-ink-muted">{log.target ?? "—"}</td>
            <td class="max-w-xs truncate px-4 py-2 font-mono text-xs text-ink-faint">
              {log.detail ?? ""}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Card>
