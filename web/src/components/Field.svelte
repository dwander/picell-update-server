<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    hint?: string;
    children: Snippet;
    for?: string;
  }

  let { label, hint, children, for: htmlFor }: Props = $props();
</script>

<label class="block" for={htmlFor}>
  <span class="mb-1 block text-xs font-medium text-ink-muted">{label}</span>
  {@render children()}
  {#if hint}<span class="mt-1 block text-xs text-ink-faint whitespace-pre-line">{hint}</span>{/if}
</label>
