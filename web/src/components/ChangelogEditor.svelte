<script lang="ts">
  import { ArrowDown, ArrowUp, Code, FileUp, List, Plus, Save, Trash2 } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { confirms, toasts } from "../lib/ui.svelte.js";
  import { CHANGELOG_TYPE_LABELS } from "../lib/format.js";
  import Button from "./Button.svelte";
  import Markdown from "./Markdown.svelte";
  import type { ChangelogDTO, ChangelogType, Locale } from "../../../src/types.js";

  interface Props {
    releaseId: string;
    /** 파일에서 이 버전 블록만 골라 오기 위해 필요하다. */
    version: string;
    changelogs: ChangelogDTO[];
    onsaved: (changelog: ChangelogDTO) => void;
  }

  let { releaseId, version, changelogs, onsaved }: Props = $props();

  const LOCALES: { value: Locale; label: string }[] = [
    { value: "ko", label: "한국어" },
    { value: "en", label: "English" },
  ];
  const TYPES = Object.keys(CHANGELOG_TYPE_LABELS) as ChangelogType[];
  const INPUT_CLASS =
    "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  let locale = $state<Locale>("ko");
  /** items = 항목 편집, markdown = 마크다운 직접 작성 */
  let mode = $state<"items" | "markdown">("items");
  let busy = $state(false);

  // 편집 중인 초안. 로케일을 바꾸면 서버 값으로 다시 채운다.
  let summary = $state("");
  let bodyMarkdown = $state("");
  let items = $state<{ type: ChangelogType; text: string }[]>([]);
  let loadedLocale = $state<Locale | null>(null);

  // changelog.txt 불러오기 상태 (동작은 아래 importFile).
  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);
  let importedFrom = $state<string | null>(null);
  /** dragleave는 자식 위로 옮겨갈 때도 뜬다. 깊이로 세어 깜빡임을 막는다. */
  let dragDepth = $state(0);
  const dragging = $derived(dragDepth > 0);
  const hasDraft = $derived(Boolean(bodyMarkdown.trim() || items.some((i) => i.text.trim())));

  const current = $derived(changelogs.find((c) => c.locale === locale));

  $effect(() => {
    // 초안을 덮어쓰지 않도록 로케일이 실제로 바뀐 순간에만 다시 채운다.
    if (loadedLocale === locale) return;
    const source = changelogs.find((c) => c.locale === locale);
    summary = source?.summary ?? "";
    bodyMarkdown = source?.bodyMarkdown ?? "";
    items = (source?.items ?? []).map((i) => ({ type: i.type, text: i.text }));
    mode = (source?.bodyMarkdown ?? "").trim() ? "markdown" : "items";
    importedFrom = null;
    loadedLocale = locale;
  });

  /** 클라이언트가 실제로 받을 결과 — 마크다운이 비어 있으면 항목에서 생성된다. */
  const preview = $derived(
    bodyMarkdown.trim() ||
      TYPES.map((type) => {
        const rows = items.filter((i) => i.type === type && i.text.trim());
        if (rows.length === 0) return "";
        return `### ${CHANGELOG_TYPE_LABELS[type]}\n${rows.map((r) => `- ${r.text.trim()}`).join("\n")}`;
      })
        .filter(Boolean)
        .join("\n\n"),
  );

  function addItem(): void {
    items = [...items, { type: "added", text: "" }];
  }

  function removeItem(index: number): void {
    items = items.filter((_, i) => i !== index);
  }

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    items = next;
  }

  // ─── changelog.txt에서 이 버전만 가져오기 ─────────────────────────────────
  //
  // 파일 전체를 서버가 버전 블록으로 갈라 주면 그중 이 릴리즈 버전 하나만 초안에
  // 채운다. 저장은 하지 않는다 — 사람이 미리보기로 확인하고 저장 버튼을 눌러야 한다.

  async function importFile(file: File): Promise<void> {
    if (hasDraft) {
      const ok = await confirms.ask(
        "체인지로그 불러오기",
        `${file.name}의 ${version} 부분으로 편집 중인 내용을 덮어씁니다.\n저장하기 전까지는 서버에 반영되지 않습니다.`,
        { confirmLabel: "덮어쓰기", danger: true },
      );
      if (!ok) return;
    }

    importing = true;
    try {
      const text = await file.text();
      const { entries } = await api.parseChangelog(text, locale);
      const entry = entries.find((e) => e.version === version);
      if (!entry) {
        const known = entries
          .filter((e) => !e.isLatest)
          .map((e) => e.rawVersion)
          .slice(0, 6)
          .join(", ");
        toasts.error(
          `파일에서 ${version} 블록을 찾지 못했습니다.${known ? ` 인식된 버전: ${known}…` : ""}`,
        );
        return;
      }

      bodyMarkdown = entry.markdown;
      items = entry.items.map((i) => ({ type: i.type, text: i.text }));
      // 원문 마크다운이 곧 결과물이다(카테고리 제목이 우리 6종에 없을 수 있다).
      mode = "markdown";
      importedFrom = file.name;
      toasts.ok(`${version} 항목 ${entry.items.length}건을 불러왔습니다. 확인 후 저장하세요.`);
    } catch (e) {
      toasts.error(e);
    } finally {
      importing = false;
    }
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragDepth = 0;
    const file = e.dataTransfer?.files?.[0];
    if (file) void importFile(file);
  }

  async function save(): Promise<void> {
    busy = true;
    try {
      const { changelog } = await api.saveChangelog(releaseId, locale, {
        summary,
        // 항목 모드에서는 마크다운을 비워 항목이 출처가 되게 한다.
        bodyMarkdown: mode === "markdown" ? bodyMarkdown : "",
        items: items.filter((i) => i.text.trim()),
      });
      onsaved(changelog);
      loadedLocale = null; // 저장 결과로 초안을 다시 동기화
      toasts.ok(`${locale === "ko" ? "한국어" : "영문"} 체인지로그를 저장했습니다.`);
    } catch (e) {
      toasts.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
  <div class="flex gap-1">
    {#each LOCALES as l (l.value)}
      <button
        type="button"
        class="rounded-md px-2.5 py-1 text-xs transition-colors {locale === l.value
          ? 'bg-surface-3 font-medium text-ink'
          : 'text-ink-faint hover:text-ink-muted'}"
        onclick={() => (locale = l.value)}
      >
        {l.label}
        {#if changelogs.find((c) => c.locale === l.value)?.rendered}
          <span class="ml-1 text-ok">•</span>
        {/if}
      </button>
    {/each}
  </div>
  <div class="flex items-center gap-2">
    <div class="flex rounded-lg border border-line p-0.5">
      <button
        type="button"
        title="항목 편집"
        class="rounded-md px-2 py-1 transition-colors {mode === 'items'
          ? 'bg-surface-3 text-ink'
          : 'text-ink-faint hover:text-ink-muted'}"
        onclick={() => (mode = "items")}
      >
        <List size={13} />
      </button>
      <button
        type="button"
        title="마크다운 직접 작성"
        class="rounded-md px-2 py-1 transition-colors {mode === 'markdown'
          ? 'bg-surface-3 text-ink'
          : 'text-ink-faint hover:text-ink-muted'}"
        onclick={() => (mode = "markdown")}
      >
        <Code size={13} />
      </button>
    </div>
    <Button loading={importing} onclick={() => fileInput?.click()}>
      <FileUp size={13} />파일에서 불러오기
    </Button>
    <Button variant="primary" loading={busy} onclick={save}>
      <Save size={13} />저장
    </Button>
  </div>
</div>

<input
  type="file"
  accept=".txt,.md,text/plain,text/markdown"
  bind:this={fileInput}
  class="hidden"
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    if (file) void importFile(file);
    e.currentTarget.value = "";
  }}
/>

<!-- 섹션 전체를 드롭 대상으로 둔다. 텍스트영역 위에 떨어뜨리면 브라우저가 그 파일로
     이동해 편집 중인 내용이 날아가기 때문이다. -->
<div
  role="region"
  aria-label="체인지로그 파일 드롭 영역"
  class="relative"
  ondragenter={(e) => {
    e.preventDefault();
    dragDepth += 1;
  }}
  ondragover={(e) => e.preventDefault()}
  ondragleave={() => (dragDepth = Math.max(0, dragDepth - 1))}
  ondrop={onDrop}
>
  {#if dragging}
    <div
      class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-surface-0/85 text-sm text-ink"
    >
      놓으면 {version} 부분만 불러옵니다.
    </div>
  {/if}

  <div class="grid gap-4 p-4 lg:grid-cols-2">
    <div class="space-y-3">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 text-xs transition-colors {dragging
          ? 'border-accent text-accent'
          : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-muted'}"
        onclick={() => fileInput?.click()}
      >
        <FileUp size={13} />
        {#if importedFrom}
          <span class="font-mono text-ink-muted">{importedFrom}</span>
          <span>에서 {version} 부분을 불러왔습니다 · 다시 선택</span>
        {:else}
          changelog.txt를 여기에 놓으면 <span class="font-mono text-ink-muted">{version}</span>
          부분만 불러옵니다
        {/if}
      </button>

      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-muted">한 줄 요약</span>
        <input
          bind:value={summary}
          placeholder="업데이트 다이얼로그 헤드라인"
          class={INPUT_CLASS}
        />
      </label>

      {#if mode === "markdown"}
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-ink-muted">마크다운</span>
          <textarea
            bind:value={bodyMarkdown}
            rows="16"
            placeholder={"### 추가\n- 새 기능\n· 세부 설명\n\n### 수정\n- 버그 수정"}
            class="{INPUT_CLASS} resize-y font-mono text-xs"
          ></textarea>
          <span class="mt-1 block text-xs text-ink-faint">
            비워두면 아래 항목 목록에서 자동 생성됩니다. `·`로 시작한 줄은 하위 항목이 됩니다.
          </span>
        </label>
      {:else}
        <div>
          <span class="mb-1 block text-xs font-medium text-ink-muted">변경 항목</span>
          {#if items.length === 0}
            <p class="rounded-lg border border-dashed border-line py-6 text-center text-xs text-ink-faint">
              항목이 없습니다.
            </p>
          {:else}
            <ul class="space-y-1.5">
              {#each items as item, index (index)}
                <li class="flex items-start gap-1.5">
                  <select
                    bind:value={item.type}
                    class="w-20 shrink-0 rounded-lg border border-line bg-surface-0 px-2 py-2 text-xs text-ink outline-none focus:border-accent"
                  >
                    {#each TYPES as type (type)}
                      <option value={type}>{CHANGELOG_TYPE_LABELS[type]}</option>
                    {/each}
                  </select>
                  <input
                    bind:value={item.text}
                    placeholder="변경 내용"
                    class="{INPUT_CLASS} min-w-0 flex-1 py-2"
                  />
                  <div class="flex shrink-0">
                    <button
                      type="button"
                      aria-label="위로"
                      class="p-1.5 text-ink-faint transition-colors hover:text-ink disabled:opacity-30"
                      disabled={index === 0}
                      onclick={() => move(index, -1)}><ArrowUp size={13} /></button
                    >
                    <button
                      type="button"
                      aria-label="아래로"
                      class="p-1.5 text-ink-faint transition-colors hover:text-ink disabled:opacity-30"
                      disabled={index === items.length - 1}
                      onclick={() => move(index, 1)}><ArrowDown size={13} /></button
                    >
                    <button
                      type="button"
                      aria-label="삭제"
                      class="p-1.5 text-ink-faint transition-colors hover:text-danger"
                      onclick={() => removeItem(index)}><Trash2 size={13} /></button
                    >
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
          <Button class="mt-2" onclick={addItem}><Plus size={13} />항목 추가</Button>
        </div>
      {/if}
    </div>

    <div class="rounded-lg border border-line bg-surface-0 p-3">
      <p class="mb-2 text-xs font-medium text-ink-faint">클라이언트에 표시될 내용</p>
      {#if summary}
        <p class="mb-2 text-sm font-medium text-ink">{summary}</p>
      {/if}
      <Markdown source={preview} empty="아직 작성된 내용이 없습니다." />
      {#if current?.updatedAt}
        <p class="mt-3 border-t border-line pt-2 text-xs text-ink-faint">
          마지막 저장: {new Date(current.updatedAt).toLocaleString("ko-KR")}
        </p>
      {/if}
    </div>
  </div>
</div>
