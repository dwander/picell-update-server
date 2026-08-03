<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title?: string;
    subtitle?: string;
    actions?: Snippet;
    children: Snippet;
    padded?: boolean;
    class?: string;
  }

  let { title, subtitle, actions, children, padded = true, class: klass = "" }: Props = $props();
</script>

<section class="rounded-xl border border-line bg-surface-1 {klass}">
  {#if title || actions}
    <header class="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
      <div>
        {#if title}<h2 class="text-sm font-semibold text-ink">{title}</h2>{/if}
        {#if subtitle}<p class="mt-0.5 text-xs text-ink-faint">{subtitle}</p>{/if}
      </div>
      {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
    </header>
  {/if}
  <div class={padded ? "p-4" : ""}>{@render children()}</div>
</section>
