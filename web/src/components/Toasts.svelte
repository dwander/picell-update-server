<script lang="ts">
  import { CircleCheck, TriangleAlert, Info, X } from "lucide-svelte";
  import { toasts, type ToastKind } from "../lib/ui.svelte.js";

  // 색 외에 아이콘으로도 구분한다 (규칙 16).
  const ICONS = { ok: CircleCheck, error: TriangleAlert, info: Info };
  const TONES: Record<ToastKind, string> = {
    ok: "border-ok/40 text-ok",
    error: "border-danger/40 text-danger",
    info: "border-accent/40 text-accent",
  };
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-100 flex w-80 flex-col gap-2">
  {#each toasts.items as toast (toast.id)}
    {@const Icon = ICONS[toast.kind]}
    <div
      class="pointer-events-auto flex items-start gap-2 rounded-lg border bg-surface-2 px-3 py-2 shadow-lg {TONES[
        toast.kind
      ]}"
    >
      <Icon size={15} class="mt-0.5 shrink-0" />
      <p class="flex-1 text-xs whitespace-pre-line text-ink">{toast.message}</p>
      <button
        type="button"
        aria-label="알림 닫기"
        class="shrink-0 text-ink-faint transition-colors hover:text-ink"
        onclick={() => toasts.dismiss(toast.id)}
      >
        <X size={13} />
      </button>
    </div>
  {/each}
</div>
