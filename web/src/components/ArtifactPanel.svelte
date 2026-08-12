<script lang="ts">
  import { onMount } from "svelte";
  import { CircleCheck, CircleAlert, Link2, Trash2, Upload } from "lucide-svelte";
  import { api, uploadToR2 } from "../lib/api.js";
  import { confirms, takePendingUpload, toasts } from "../lib/ui.svelte.js";
  import { formatBytes, shortSha } from "../lib/format.js";
  import Badge from "./Badge.svelte";
  import Button from "./Button.svelte";
  import Modal from "./Modal.svelte";
  import Field from "./Field.svelte";
  import EmptyState from "./EmptyState.svelte";
  import { isArch, isPlatform } from "../lib/guards.js";
  import type { Arch, ArtifactDTO, Platform } from "../../../src/types.js";

  interface Props {
    releaseId: string;
    artifacts: ArtifactDTO[];
    storageConfigured: boolean;
    onchanged: () => void;
  }

  let { releaseId, artifacts, storageConfigured, onchanged }: Props = $props();

  const PLATFORMS: { value: Platform; label: string }[] = [
    { value: "windows", label: "Windows" },
    { value: "macos", label: "macOS" },
    { value: "linux", label: "Linux" },
  ];
  const ARCHES: Arch[] = ["x64", "arm64", "universal"];
  const INPUT_CLASS =
    "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  /** 업로드 대상 분류는 파일마다 묻지 않고 패널 상단에서 한 번 고른다. */
  let platform = $state<Platform>("windows");
  let arch = $state<Arch>("x64");

  let dragging = $state(false);
  interface UploadTask {
    id: number;
    name: string;
    loaded: number;
    total: number;
    phase: string;
  }

  let uploads = $state<UploadTask[]>([]);
  let nextUploadId = 0;
  let importing = $state(false);
  let importUrl = $state("");
  let importBusy = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  /**
   * 진행 상태는 **$state 배열 안의 요소를 찾아** 고친다.
   * 바깥에 들고 있던 원본 객체를 고치면 프록시를 우회해 반응성이 안 걸리고,
   * 원본과 프록시는 서로 !== 라서 완료 후 목록에서 지워지지도 않는다.
   */
  function patchUpload(id: number, patch: Partial<UploadTask>): void {
    const target = uploads.find((u) => u.id === id);
    if (target) Object.assign(target, patch);
  }

  async function uploadFile(file: File): Promise<void> {
    const id = nextUploadId++;
    uploads.push({ id, name: file.name, loaded: 0, total: file.size, phase: "준비 중" });

    const update = (patch: Partial<UploadTask>): void => patchUpload(id, patch);

    try {
      const { artifactId, uploadUrl } = await api.presignUpload(releaseId, {
        fileName: file.name,
        platform,
        arch,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });

      update({ phase: "업로드 중" });
      await uploadToR2(uploadUrl, file, (loaded, total) => update({ loaded, total }));

      // 완료 처리에서 서버가 R2를 되읽어 sha256을 계산한다 — 큰 파일은 몇 초 걸린다.
      update({ phase: "검증 중" });
      await api.completeUpload(artifactId);
      toasts.ok(`${file.name} 업로드 완료`);
      onchanged();
    } catch (e) {
      toasts.error(e);
    } finally {
      uploads = uploads.filter((u) => u.id !== id);
    }
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    if (!storageConfigured) {
      toasts.error("R2 스토리지가 설정되지 않았습니다.");
      return;
    }
    // 동시 업로드는 대역폭을 나눠 먹기만 하므로 순차로 처리한다.
    for (const file of Array.from(files)) await uploadFile(file);
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragging = false;
    void handleFiles(e.dataTransfer?.files ?? null);
  }

  async function runImport(): Promise<void> {
    if (!importUrl.trim() || importBusy) return;
    importBusy = true;
    try {
      const { artifact } = await api.importArtifactUrl(releaseId, {
        url: importUrl.trim(),
        platform,
        arch,
      });
      toasts.ok(`${artifact.fileName}을(를) R2로 가져왔습니다.`);
      importing = false;
      importUrl = "";
      onchanged();
    } catch (e) {
      toasts.error(e);
    } finally {
      importBusy = false;
    }
  }

  async function remove(artifact: ArtifactDTO): Promise<void> {
    const ok = await confirms.ask(
      "아티팩트 삭제",
      `${artifact.fileName}을(를) R2에서 영구 삭제합니다.\n이 작업은 되돌릴 수 없습니다.`,
      { confirmLabel: "삭제", danger: true },
    );
    if (!ok) return;
    try {
      await api.deleteArtifact(artifact.id);
      toasts.ok("삭제했습니다.");
      onchanged();
    } catch (e) {
      toasts.error(e);
    }
  }

  // 릴리즈 생성 화면에서 파일을 고른 채로 만들었으면 그대로 업로드까지 이어간다.
  onMount(() => {
    const handoff = takePendingUpload(releaseId);
    if (!handoff || !storageConfigured) return;
    if (isPlatform(handoff.platform)) platform = handoff.platform;
    if (isArch(handoff.arch)) arch = handoff.arch;
    void uploadFile(handoff.file);
  });

  async function copyDownloadLink(artifact: ArtifactDTO): Promise<void> {
    try {
      const { url, expiresInSec } = await api.artifactDownloadUrl(artifact.id);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // 클립보드 접근이 막힌 환경(비보안 컨텍스트 등)에서는 직접 복사하게 보여준다.
        window.prompt("아래 링크를 복사하세요.", url);
        return;
      }
      toasts.ok(
        expiresInSec === null
          ? "다운로드 링크를 복사했습니다."
          : `다운로드 링크를 복사했습니다 (${Math.round(expiresInSec / 60)}분간 유효).`,
      );
    } catch (e) {
      toasts.error(e);
    }
  }

  async function verify(artifact: ArtifactDTO): Promise<void> {
    try {
      const result = await api.verifyArtifact(artifact.id);
      if (result.ok) toasts.ok(`R2에 존재합니다 (${formatBytes(result.size)}).`);
      else toasts.error("R2에서 파일을 찾을 수 없습니다. 재업로드가 필요합니다.");
    } catch (e) {
      toasts.error(e);
    }
  }
</script>

<div class="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
  <Field label="플랫폼">
    <select bind:value={platform} class="{INPUT_CLASS} w-32 py-1.5">
      {#each PLATFORMS as p (p.value)}
        <option value={p.value}>{p.label}</option>
      {/each}
    </select>
  </Field>
  <Field label="아키텍처">
    <select bind:value={arch} class="{INPUT_CLASS} w-28 py-1.5">
      {#each ARCHES as a (a)}
        <option value={a}>{a}</option>
      {/each}
    </select>
  </Field>
  <div class="ml-auto flex gap-2">
    <Button onclick={() => (importing = true)} disabled={!storageConfigured}>
      <Link2 size={13} />URL에서 가져오기
    </Button>
    <Button variant="primary" onclick={() => fileInput?.click()} disabled={!storageConfigured}>
      <Upload size={13} />파일 업로드
    </Button>
  </div>
</div>

<input
  type="file"
  multiple
  bind:this={fileInput}
  class="hidden"
  onchange={(e) => {
    void handleFiles(e.currentTarget.files);
    e.currentTarget.value = "";
  }}
/>

<div
  role="region"
  aria-label="파일 드롭 영역"
  class="m-4 rounded-lg border-2 border-dashed p-4 text-center transition-colors {dragging
    ? 'border-accent bg-accent/8'
    : 'border-line'}"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <p class="text-xs text-ink-faint">
    {#if storageConfigured}
      여기에 설치 파일을 끌어다 놓으면 위에서 고른 플랫폼·아키텍처로 R2에 업로드됩니다.
    {:else}
      STORAGE_* 환경변수가 설정되지 않아 업로드할 수 없습니다.
    {/if}
  </p>
</div>

{#if uploads.length > 0}
  <ul class="space-y-2 px-4 pb-4">
    {#each uploads as u (u.id)}
      <li class="rounded-lg border border-line bg-surface-0 p-3">
        <div class="flex justify-between text-xs">
          <span class="truncate text-ink">{u.name}</span>
          <span class="ml-2 shrink-0 font-mono text-ink-faint">
            {u.phase} · {formatBytes(u.loaded)} / {formatBytes(u.total)}
          </span>
        </div>
        <div class="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            class="h-full rounded-full bg-accent transition-[width]"
            style="width: {u.total ? (u.loaded / u.total) * 100 : 0}%"
          ></div>
        </div>
      </li>
    {/each}
  </ul>
{/if}

{#if artifacts.length === 0}
  <EmptyState
    title="아티팩트가 없습니다."
    body="설치 파일을 업로드해야 릴리즈를 발행할 수 있습니다."
  />
{:else}
  <table class="w-full text-sm">
    <thead>
      <tr class="border-y border-line text-left text-xs text-ink-faint">
        <th class="px-4 py-2 font-medium">파일</th>
        <th class="px-4 py-2 font-medium">분류</th>
        <th class="px-4 py-2 text-right font-medium">크기</th>
        <th class="px-4 py-2 font-medium">sha256</th>
        <th class="px-4 py-2 text-right font-medium">다운로드</th>
        <th class="px-4 py-2"></th>
      </tr>
    </thead>
    <tbody class="divide-y divide-line">
      {#each artifacts as a (a.id)}
        <tr>
          <td class="px-4 py-2.5">
            <div class="flex items-center gap-1.5">
              {#if a.status === "ready"}
                <CircleCheck size={13} class="shrink-0 text-ok" />
              {:else}
                <CircleAlert size={13} class="shrink-0 text-warn" />
              {/if}
              <span class="truncate text-xs text-ink">{a.fileName}</span>
            </div>
            <p class="mt-0.5 truncate font-mono text-xs text-ink-faint">{a.storageKey}</p>
          </td>
          <td class="px-4 py-2.5">
            <span class="flex flex-wrap gap-1">
              <Badge tone="neutral">{a.platform}</Badge>
              <Badge tone="neutral">{a.arch}</Badge>
              <Badge tone="neutral">{a.kind}</Badge>
            </span>
          </td>
          <td class="px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
            {formatBytes(a.size)}
          </td>
          <td class="px-4 py-2.5 font-mono text-xs text-ink-faint" title={a.sha256 ?? ""}>
            {shortSha(a.sha256)}
          </td>
          <td class="px-4 py-2.5 text-right font-mono text-xs text-ink-muted">
            {a.downloadCount}
          </td>
          <td class="px-4 py-2.5">
            <div class="flex justify-end gap-1">
              <Button variant="ghost" onclick={() => verify(a)}>확인</Button>
              <button
                type="button"
                aria-label="다운로드 링크 복사"
                title="다운로드 링크 복사"
                class="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink"
                onclick={() => copyDownloadLink(a)}
              >
                <Link2 size={13} />
              </button>
              <button
                type="button"
                aria-label="아티팩트 삭제"
                class="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-3 hover:text-danger"
                onclick={() => remove(a)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<Modal title="URL에서 가져오기" open={importing} onclose={() => (importing = false)}>
  <div class="space-y-3">
    <Field
      label="파일 URL"
      hint={"서버가 직접 내려받아 R2로 올립니다.\nGitHub 릴리즈 에셋 URL을 그대로 붙여 넣어도 됩니다."}
    >
      <input bind:value={importUrl} placeholder="https://…" class="{INPUT_CLASS} font-mono text-xs" />
    </Field>
    <p class="text-xs text-ink-faint">
      분류: {platform} · {arch}
    </p>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (importing = false)}>취소</Button>
    <Button variant="primary" loading={importBusy} onclick={runImport}>가져오기</Button>
  {/snippet}
</Modal>
