<script lang="ts">
  import type { Snippet } from "svelte";

  type Tone = "neutral" | "ok" | "warn" | "danger" | "beta" | "accent";

  interface Props {
    tone?: Tone;
    children: Snippet;
    title?: string;
  }

  let { tone = "neutral", children, title }: Props = $props();

  const TONES: Record<Tone, string> = {
    neutral: "bg-surface-3 text-ink-muted border-line-strong",
    ok: "bg-ok/12 text-ok border-ok/35",
    warn: "bg-warn/12 text-warn border-warn/35",
    danger: "bg-danger/12 text-danger border-danger/35",
    beta: "bg-beta/12 text-beta border-beta/35",
    accent: "bg-accent/12 text-accent border-accent/35",
  };
</script>

<span
  {title}
  class="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap {TONES[tone]}"
>
  {@render children()}
</span>
