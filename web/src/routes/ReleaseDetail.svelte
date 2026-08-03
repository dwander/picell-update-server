<script lang="ts">
  import { onMount } from "svelte";
  import { ArrowLeft, Save, Send, Trash2, Undo2 } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import { router } from "../lib/router.svelte.js";
  import { confirms, toasts } from "../lib/ui.svelte.js";
  import { formatBytes, formatDate, formatNumber } from "../lib/format.js";
  import Card from "../components/Card.svelte";
  import Button from "../components/Button.svelte";
  import Field from "../components/Field.svelte";
  import ReleaseBadges from "../components/ReleaseBadges.svelte";
  import ArtifactPanel from "../components/ArtifactPanel.svelte";
  import ChangelogEditor from "../components/ChangelogEditor.svelte";
  import type { Channel, ReleaseDTO } from "../../../src/types.js";

  interface Props {
    releaseId: string;
  }

  let { releaseId }: Props = $props();

  const INPUT_CLASS =
    "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  let release = $state<ReleaseDTO | null>(null);
  let loading = $state(true);
  let savingMeta = $state(false);
  let storageConfigured = $state(true);

  // 메타 편집 초안 (규칙 9: 저장 시 필요한 필드만 patch로 보낸다)
  let meta = $state({
    name: "",
    channel: "stable" as Channel,
    mandatory: false,
    minSupportedVersion: "",
    rolloutPercent: 100,
  });

  function syncMeta(r: ReleaseDTO): void {
    meta = {
      name: r.name,
      channel: r.channel,
      mandatory: r.mandatory,
      minSupportedVersion: r.minSupportedVersion ?? "",
      rolloutPercent: r.rolloutPercent,
    };
  }

  async function load(): Promise<void> {
    try {
      const { release: r } = await api.getRelease(releaseId);
      release = r;
      syncMeta(r);
    } catch (e) {
      toasts.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    storageConfigured = await api
      .config()
      .then((c) => c.storageConfigured)
      .catch(() => false);
    await load();
  });

  async function saveMeta(): Promise<void> {
    savingMeta = true;
    try {
      const { release: r } = await api.updateRelease(releaseId, {
        name: meta.name,
        channel: meta.channel,
        mandatory: meta.mandatory,
        minSupportedVersion: meta.minSupportedVersion.trim() || null,
        rolloutPercent: meta.rolloutPercent,
      });
      release = r;
      syncMeta(r);
      toasts.ok("릴리즈 정보를 저장했습니다.");
    } catch (e) {
      toasts.error(e);
    } finally {
      savingMeta = false;
    }
  }

  async function setStatus(status: "published" | "draft" | "archived"): Promise<void> {
    if (!release) return;
    const prompts = {
      published: {
        title: "릴리즈 발행",
        body: `${release.version}을(를) ${meta.channel === "beta" ? "베타" : "안정"} 채널로 배포합니다.\n클라이언트가 즉시 업데이트를 받기 시작합니다.`,
        label: "발행",
        danger: false,
      },
      archived: {
        title: "릴리즈 철회",
        body: `${release.version}을(를) 배포에서 내립니다.\n클라이언트는 이전 버전을 받게 됩니다.`,
        label: "철회",
        danger: true,
      },
      draft: {
        title: "초안으로 되돌리기",
        body: `${release.version}을(를) 초안 상태로 되돌립니다.`,
        label: "되돌리기",
        danger: false,
      },
    };
    const p = prompts[status];
    const ok = await confirms.ask(p.title, p.body, { confirmLabel: p.label, danger: p.danger });
    if (!ok) return;

    try {
      const { release: r } = await api.updateRelease(releaseId, { status });
      release = r;
      toasts.ok(`${p.title}을(를) 완료했습니다.`);
    } catch (e) {
      toasts.error(e);
    }
  }

  async function remove(): Promise<void> {
    if (!release) return;
    const ok = await confirms.ask(
      "릴리즈 삭제",
      `${release.version}과(와) R2에 있는 모든 아티팩트를 영구 삭제합니다.\n다운로드 통계 이력은 남습니다.`,
      { confirmLabel: "영구 삭제", danger: true },
    );
    if (!ok) return;
    try {
      const result = await api.deleteRelease(releaseId);
      toasts.ok(`삭제 완료 (R2 오브젝트 ${result.deletedObjects}개 제거).`);
      router.go("/releases");
    } catch (e) {
      toasts.error(e);
    }
  }

  const readyArtifacts = $derived(release?.artifacts.filter((a) => a.status === "ready") ?? []);
  const totalBytes = $derived(release?.artifacts.reduce((sum, a) => sum + a.size, 0) ?? 0);
</script>

<a
  href={router.href("/releases")}
  onclick={(e) => {
    e.preventDefault();
    router.go("/releases");
  }}
  class="mb-4 inline-flex items-center gap-1 text-xs text-ink-faint transition-colors hover:text-ink"
>
  <ArrowLeft size={13} />릴리즈 목록
</a>

{#if loading}
  <p class="py-16 text-center text-xs text-ink-faint">불러오는 중…</p>
{:else if !release}
  <p class="py-16 text-center text-xs text-ink-faint">릴리즈를 찾을 수 없습니다.</p>
{:else}
  <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
    <div>
      <div class="flex items-center gap-3">
        <h1 class="font-mono text-xl font-semibold text-ink">{release.version}</h1>
        <span class="flex flex-wrap gap-1.5">
          <ReleaseBadges
            channel={release.channel}
            status={release.status}
            mandatory={release.mandatory}
            rolloutPercent={release.rolloutPercent}
          />
        </span>
      </div>
      <p class="mt-1 text-xs text-ink-faint">
        {release.name} · 아티팩트 {readyArtifacts.length}개 · {formatBytes(totalBytes)} · 다운로드
        {formatNumber(release.downloadCount)}
        {#if release.publishedAt}· 발행 {formatDate(release.publishedAt)}{/if}
      </p>
    </div>

    <div class="flex gap-2">
      {#if release.status !== "published"}
        <Button variant="primary" onclick={() => setStatus("published")}>
          <Send size={13} />발행
        </Button>
      {:else}
        <Button variant="danger" onclick={() => setStatus("archived")}>
          <Undo2 size={13} />철회
        </Button>
      {/if}
      {#if release.status === "archived"}
        <Button onclick={() => setStatus("draft")}>초안으로</Button>
      {/if}
      <Button variant="ghost" onclick={remove}><Trash2 size={13} />삭제</Button>
    </div>
  </header>

  <Card title="배포 설정" class="mb-4">
    {#snippet actions()}
      <Button variant="primary" loading={savingMeta} onclick={saveMeta}>
        <Save size={13} />저장
      </Button>
    {/snippet}

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="표시 이름">
        <input bind:value={meta.name} class={INPUT_CLASS} />
      </Field>

      <Field label="채널" hint="베타 채널 클라이언트는 안정 버전이 더 높으면 그쪽을 받습니다.">
        <select bind:value={meta.channel} class={INPUT_CLASS}>
          <option value="stable">안정</option>
          <option value="beta">베타</option>
        </select>
      </Field>

      <Field
        label="단계적 배포 (%)"
        hint={"machineId 해시로 결정론적 분배.\n100 미만이면 machineId를 보내지 않는 클라이언트는 제외됩니다."}
      >
        <input
          type="number"
          min="0"
          max="100"
          bind:value={meta.rolloutPercent}
          class="{INPUT_CLASS} font-mono"
        />
      </Field>

      <Field
        label="최소 지원 버전"
        hint="이 버전 미만 사용자는 강제 업데이트 대상이 됩니다. 비우면 미적용."
      >
        <input
          bind:value={meta.minSupportedVersion}
          placeholder="1.0.0"
          class="{INPUT_CLASS} font-mono"
        />
      </Field>

      <div class="flex items-end">
        <label class="flex cursor-pointer items-center gap-2 py-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            bind:checked={meta.mandatory}
            class="size-4 rounded border-line bg-surface-0 accent-accent"
          />
          강제 업데이트
        </label>
      </div>
    </div>
  </Card>

  <Card title="아티팩트" subtitle="R2 picell-one 버킷에 저장됩니다." class="mb-4" padded={false}>
    <ArtifactPanel
      {releaseId}
      artifacts={release.artifacts}
      {storageConfigured}
      onchanged={load}
    />
  </Card>

  <Card title="체인지로그" padded={false}>
    <ChangelogEditor
      {releaseId}
      changelogs={release.changelogs}
      onsaved={(changelog) => {
        if (!release) return;
        release = {
          ...release,
          changelogs: release.changelogs.map((c) =>
            c.locale === changelog.locale ? changelog : c,
          ),
        };
      }}
    />
  </Card>
{/if}
