<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    body?: string;
    action?: Snippet;
  }

  let { title, body, action }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
  <p class="text-sm font-medium text-ink-muted">{title}</p>
  {#if body}<p class="max-w-md text-xs whitespace-pre-line text-ink-faint">{body}</p>{/if}
  {#if action}<div class="mt-2">{@render action()}</div>{/if}
</div>
