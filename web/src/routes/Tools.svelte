<script lang="ts">
  import { onMount } from "svelte";
  import { Download, FileUp, GitBranch, ScrollText } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { confirms, toasts } from "../lib/ui.svelte.js";
  import { formatBytes, formatDate, formatDay } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Badge from "../components/Badge.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import type {
    Arch,
    Channel,
    ChangelogImportEntryDTO,
    Locale,
    Platform,
  } from "../../../src/types.js";

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

  // ─── 체인지로그 파일 임포트 ────────────────────────────────────────────────

  let changelogText = $state("");
  let changelogFileName = $state("");
  let changelogLocale = $state<Locale>("ko");
  let changelogEntries = $state<ChangelogImportEntryDTO[] | null>(null);
  let changelogBusy = $state(false);
  let changelogInput = $state<HTMLInputElement | null>(null);

  async function readChangelogFile(file: File): Promise<void> {
    changelogBusy = true;
    try {
      changelogText = await file.text();
      changelogFileName = file.name;
      const result = await api.parseChangelog(changelogText, changelogLocale);
      changelogEntries = result.entries;
      toasts.info(`버전 ${result.entries.length}건 인식 · 릴리즈 매칭 ${result.matched}건`);
    } catch (e) {
      toasts.error(e);
      changelogEntries = null;
    } finally {
      changelogBusy = false;
    }
  }

  async function applyChangelog(): Promise<void> {
    const targets = (changelogEntries ?? []).filter((e) => e.releaseId);
    if (targets.length === 0) return;
    const ok = await confirms.ask(
      "체인지로그 일괄 반영",
      `매칭된 릴리즈 ${targets.length}건의 ${changelogLocale === "ko" ? "한국어" : "영문"} 노트를 덮어씁니다.\n기존에 작성한 내용이 있으면 사라집니다.`,
      { confirmLabel: "반영", danger: true },
    );
    if (!ok) return;

    changelogBusy = true;
    try {
      const result = await api.applyChangelog(changelogText, changelogLocale);
      toasts.ok(`릴리즈 ${result.appliedCount}건에 반영했습니다.`);
      logs = (await api.auditLogs()).logs;
    } catch (e) {
      toasts.error(e);
    } finally {
      changelogBusy = false;
    }
  }

  const changelogMatched = $derived((changelogEntries ?? []).filter((e) => e.releaseId).length);

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
  title="체인지로그 파일 임포트"
  subtitle="changelog.txt를 올리면 버전별로 갈라 매칭되는 릴리즈에 한 번에 반영합니다."
  class="mb-4"
  padded={false}
>
  {#snippet actions()}
    <div class="flex rounded-lg border border-line p-0.5">
      {#each [{ v: "ko", l: "한국어" }, { v: "en", l: "English" }] as opt (opt.v)}
        <button
          type="button"
          class="rounded-md px-2.5 py-1 text-xs transition-colors {changelogLocale === opt.v
            ? 'bg-surface-3 font-medium text-ink'
            : 'text-ink-faint hover:text-ink-muted'}"
          onclick={() => {
            changelogLocale = opt.v as Locale;
            if (changelogText) void api
              .parseChangelog(changelogText, changelogLocale)
              .then((r) => (changelogEntries = r.entries))
              .catch(toasts.error);
          }}
        >
          {opt.l}
        </button>
      {/each}
    </div>
    <Button loading={changelogBusy} onclick={() => changelogInput?.click()}>
      <FileUp size={13} />파일 선택
    </Button>
  {/snippet}

  <input
    type="file"
    accept=".txt,.md,text/plain,text/markdown"
    bind:this={changelogInput}
    class="hidden"
    onchange={(e) => {
      const file = e.currentTarget.files?.[0];
      if (file) void readChangelogFile(file);
      e.currentTarget.value = "";
    }}
  />

  {#if !changelogEntries}
    <EmptyState
      title="체인지로그 파일을 선택하세요."
      body={"'## [0.5.33] 2026-07-18' 형식의 버전 헤딩과 '### 개선' / '- 항목' 구조를 읽습니다.\n카테고리 제목은 원문 그대로 보존되고, 항목 타입은 최대한 자동 분류합니다."}
    />
  {:else}
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-xs">
      <span class="font-mono text-ink-muted">{changelogFileName}</span>
      <Badge tone="accent">인식 {changelogEntries.length}</Badge>
      <Badge tone={changelogMatched > 0 ? "ok" : "warn"}>매칭 {changelogMatched}</Badge>
      <Button
        class="ml-auto"
        variant="primary"
        loading={changelogBusy}
        disabled={changelogMatched === 0}
        onclick={applyChangelog}
      >
        매칭된 {changelogMatched}건 반영
      </Button>
    </div>
    <ul class="max-h-96 divide-y divide-line overflow-y-auto">
      {#each changelogEntries as entry (entry.rawVersion)}
        <li class="flex flex-wrap items-center gap-3 px-4 py-2">
          <span class="w-28 shrink-0 font-mono text-sm text-ink">{entry.rawVersion}</span>
          <span class="shrink-0">
            {#if entry.isLatest}
              <Badge tone="neutral">개발 중 · 건너뜀</Badge>
            {:else if entry.releaseId}
              <Badge tone="ok">반영 대상</Badge>
            {:else}
              <Badge tone="warn">릴리즈 없음</Badge>
            {/if}
          </span>
          <span class="min-w-0 flex-1 truncate text-xs text-ink-faint">
            {entry.releaseName ?? entry.date ?? ""}
          </span>
          <span class="shrink-0 font-mono text-xs text-ink-muted">항목 {entry.itemCount}</span>
        </li>
      {/each}
    </ul>
  {/if}
</Card>

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
