<script lang="ts">
  import type { Snippet } from "svelte";
  import { X } from "lucide-svelte";

  interface Props {
    title: string;
    open: boolean;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
    wide?: boolean;
  }

  let { title, open, onclose, children, footer, wide = false }: Props = $props();

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onclose();
  }
</script>

<svelte:window on:keydown={open ? onkeydown : undefined} />

{#if open}
  <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
    <button
      type="button"
      aria-label="닫기"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm"
      onclick={onclose}
    ></button>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      class="relative z-10 w-full {wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl border border-line-strong bg-surface-1 shadow-2xl"
    >
      <header class="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 class="text-sm font-semibold text-ink">{title}</h2>
        <button
          type="button"
          class="rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink"
          aria-label="닫기"
          onclick={onclose}
        >
          <X size={16} />
        </button>
      </header>
      <div class="max-h-[70vh] overflow-y-auto p-4">{@render children()}</div>
      {#if footer}
        <footer class="flex justify-end gap-2 border-t border-line px-4 py-3">
          {@render footer()}
        </footer>
      {/if}
    </div>
  </div>
{/if}
