<script lang="ts">
  import type { ComponentType } from "svelte";
  import { formatNumber } from "../lib/format.js";

  interface Props {
    label: string;
    value: number | string;
    hint?: string;
    icon?: ComponentType;
  }

  let { label, value, hint, icon: Icon }: Props = $props();
</script>

<div class="rounded-xl border border-line bg-surface-1 p-4">
  <div class="flex items-center gap-2 text-xs text-ink-muted">
    {#if Icon}<Icon size={13} />{/if}
    <span>{label}</span>
  </div>
  <p class="mt-1.5 font-mono text-2xl font-semibold text-ink">
    {typeof value === "number" ? formatNumber(value) : value}
  </p>
  {#if hint}<p class="mt-0.5 text-xs text-ink-faint">{hint}</p>{/if}
</div>
