<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "primary" | "ghost" | "danger" | "subtle";

  interface Props {
    variant?: Variant;
    type?: "button" | "submit";
    disabled?: boolean;
    loading?: boolean;
    title?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
    class?: string;
  }

  let {
    variant = "subtle",
    type = "button",
    disabled = false,
    loading = false,
    title,
    onclick,
    children,
    class: klass = "",
  }: Props = $props();

  const VARIANTS: Record<Variant, string> = {
    primary: "bg-accent text-surface-0 hover:bg-accent/85 font-semibold",
    subtle: "bg-surface-3 text-ink hover:bg-line-strong border border-line",
    ghost: "text-ink-muted hover:text-ink hover:bg-surface-3",
    danger: "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
  };
</script>

<button
  {type}
  {title}
  disabled={disabled || loading}
  {onclick}
  class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-45 {VARIANTS[variant]} {klass}"
>
  {#if loading}
    <span class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
    ></span>
  {/if}
  {@render children()}
</button>
