<script lang="ts">
  import { onMount } from "svelte";
  import { FileUp, Plus } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { navigate, router } from "../lib/router.svelte.js";
  import { pendingUpload, toasts } from "../lib/ui.svelte.js";
  import { formatBytes, formatDate, formatNumber } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Modal from "../components/Modal.svelte";
  import Field from "../components/Field.svelte";
  import ReleaseBadges from "../components/ReleaseBadges.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import type {
    Channel,
    InspectedFileNameDTO,
    ReleaseStatus,
    ReleaseSummaryDTO,
  } from "../../../src/types.js";

  const FILTERS: { value: ReleaseStatus | "all"; label: string }[] = [
    { value: "all", label: "전체" },
    { value: "published", label: "발행됨" },
    { value: "draft", label: "초안" },
    { value: "archived", label: "철회됨" },
  ];

  const INPUT_CLASS =
    "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  /** 서버의 DOWNLOAD_COUNT_MAX와 같은 값 — 바꿀 때 함께 고칠 것. */
  const DOWNLOAD_COUNT_MAX = 10000;

  let releases = $state<ReleaseSummaryDTO[]>([]);
  let loading = $state(true);
  let filter = $state<ReleaseStatus | "all">("all");

  let creating = $state(false);
  let busy = $state(false);
  let form = $state({ version: "", channel: "stable" as Channel, name: "" });

  // 다운로드 수 보정 — 통계 정리로 실수로 지운 기록을 숫자만 되살린다.
  let adjusting = $state<ReleaseSummaryDTO | null>(null);
  let adjustInput = $state<number | null>(0);
  let adjustBusy = $state(false);

  // 파일에서 유추한 값 — 만든 직후 그대로 업로드까지 이어가기 위해 파일을 들고 있는다.
  let pickedFile = $state<File | null>(null);
  let inspecting = $state(false);
  let inspected = $state<InspectedFileNameDTO | null>(null);
  let createFileInput = $state<HTMLInputElement | null>(null);

  /**
   * 설치 파일명에서 버전·표시 이름·채널을 채운다.
   * 추론 규칙은 서버(artifact-naming)에 한 벌만 두고 여기서는 결과만 받는다 —
   * GitHub 임포트와 같은 규칙을 써야 하므로 클라이언트에 복제하지 않는다.
   */
  async function inspectFile(file: File): Promise<void> {
    pickedFile = file;
    inspecting = true;
    try {
      const result = await api.inspectFileName(file.name);
      inspected = result;
      if (result.version) {
        form.version = result.version;
        form.channel = result.channel;
        if (result.suggestedName) form.name = result.suggestedName;
      } else {
        toasts.info("파일명에서 버전을 찾지 못했습니다. 직접 입력해 주세요.");
      }
    } catch (e) {
      toasts.error(e);
    } finally {
      inspecting = false;
    }
  }

  function resetForm(): void {
    form = { version: "", channel: "stable", name: "" };
    pickedFile = null;
    inspected = null;
  }

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
      // 파일을 고른 채로 만들었다면 상세 화면에서 곧바로 업로드까지 이어간다.
      pendingUpload.file = pickedFile;
      pendingUpload.releaseId = release.id;
      pendingUpload.platform = inspected?.platform ?? null;
      pendingUpload.arch = inspected?.arch ?? null;
      resetForm();
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

  function openAdjust(release: ReleaseSummaryDTO): void {
    adjusting = release;
    adjustInput = release.downloadCount;
  }

  /** 입력을 비우면 `null`이 들어온다 — 0으로 떨어뜨려 NaN이 비교에 섞이지 않게 한다. */
  const adjustCount = $derived(
    Math.min(Math.max(Math.trunc(Number(adjustInput) || 0), 0), DOWNLOAD_COUNT_MAX),
  );
  const adjustDiff = $derived(adjusting ? adjustCount - adjusting.downloadCount : 0);

  async function saveAdjust(): Promise<void> {
    if (!adjusting || adjustDiff === 0 || adjustBusy) return;
    adjustBusy = true;
    try {
      const result = await api.setReleaseDownloadCount(adjusting.id, adjustCount);
      const change =
        result.added > 0
          ? `${formatNumber(result.added)}건 되살림`
          : `${formatNumber(result.removed)}건 삭제`;
      toasts.ok(`${result.version}: ${change} → ${formatNumber(result.downloadCount)}건`);
      adjusting = null;
      await load();
    } catch (e) {
      toasts.error(e);
    } finally {
      adjustBusy = false;
    }
  }
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
            <td class="px-4 py-2.5 text-right">
              <!-- 행 전체가 상세로 가는 링크라 클릭을 여기서 멈춘다. -->
              <button
                type="button"
                title="다운로드 수 보정"
                class="rounded-md px-1.5 py-0.5 font-mono text-xs text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
                onclick={(e) => {
                  e.stopPropagation();
                  openAdjust(r);
                }}
              >
                {formatNumber(r.downloadCount)}
              </button>
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
    <div
      role="region"
      aria-label="설치 파일 드롭 영역"
      class="rounded-lg border-2 border-dashed border-line p-3 text-center"
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file) void inspectFile(file);
      }}
    >
      {#if inspected && pickedFile}
        <p class="truncate font-mono text-xs text-ink">{pickedFile.name}</p>
        <p class="mt-1 text-xs text-ink-faint">
          {inspected.version
            ? `${inspected.platform ?? "플랫폼 불명"} · ${inspected.arch} · ${inspected.kind}`
            : "버전을 찾지 못했습니다"}
        </p>
      {:else}
        <p class="text-xs text-ink-faint whitespace-pre-line">
          {"설치 파일을 끌어다 놓거나 선택하면 버전·이름·채널을 자동으로 채웁니다.\n예: PiCell One-0.5.33-Setup.exe"}
        </p>
      {/if}
      <Button class="mt-2" loading={inspecting} onclick={() => createFileInput?.click()}>
        <FileUp size={13} />파일 선택
      </Button>
    </div>
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

<!-- ─── 다운로드 수 보정 ────────────────────────────────────────────────────────
     통계 정리로 지운 기록은 원래 값(PC·IP·시각)을 되살릴 방법이 없어 숫자만 맞춘다. -->

<Modal title="다운로드 수 보정" open={adjusting !== null} onclose={() => (adjusting = null)}>
  {#if adjusting}
    <div class="space-y-3">
      <p class="text-xs whitespace-pre-line text-ink-faint">
        {"통계 정리로 지운 다운로드 기록을 숫자만 되살립니다.\n원래 기록의 PC·IP·시각은 복구할 수 없어, 릴리즈 발행일로 찍은 보정 행이 들어갑니다."}
      </p>

      <div class="rounded-lg border border-line bg-surface-0 px-3 py-2 text-xs">
        <span class="font-mono text-ink">{adjusting.version}</span>
        <span class="text-ink-faint">
          · 현재 {formatNumber(adjusting.downloadCount)}건
        </span>
      </div>

      <Field label="다운로드 수" hint="0 이상 {formatNumber(DOWNLOAD_COUNT_MAX)} 이하.">
        <input
          type="number"
          min="0"
          max={DOWNLOAD_COUNT_MAX}
          bind:value={adjustInput}
          class="{INPUT_CLASS} font-mono"
        />
      </Field>

      <p class="rounded-lg border border-line bg-surface-0 px-3 py-2 text-xs whitespace-pre-line">
        {#if adjustDiff > 0}
          <span class="text-ok">보정 행 {formatNumber(adjustDiff)}개를 추가합니다.</span>
          <span class="text-ink-faint">
            {"\n일별 다운로드는 발행일에 잡히고, 고유 PC 수는 늘지 않습니다."}
          </span>
        {:else if adjustDiff < 0}
          <span class="text-danger">기록 {formatNumber(-adjustDiff)}건을 지웁니다.</span>
          <span class="text-ink-faint">
            {"\n보정 행을 먼저 지우고, 그것으로 부족하면 실제 기록을 최근 것부터 지웁니다."}
          </span>
        {:else}
          <span class="text-ink-faint">현재 값과 같아 바꿀 것이 없습니다.</span>
        {/if}
      </p>
    </div>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" onclick={() => (adjusting = null)}>취소</Button>
    <Button
      variant={adjustDiff < 0 ? "danger" : "primary"}
      loading={adjustBusy}
      disabled={adjustDiff === 0}
      onclick={saveAdjust}
    >
      {adjustDiff < 0 ? "지우고 맞추기" : "되살리기"}
    </Button>
  {/snippet}
</Modal>

<input
  type="file"
  bind:this={createFileInput}
  class="hidden"
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    if (file) void inspectFile(file);
    e.currentTarget.value = "";
  }}
/>
