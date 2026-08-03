<script lang="ts">
  import { TriangleAlert, Circle, CircleCheck, CircleSlash, FlaskConical, Percent } from "lucide-svelte";
  import Badge from "./Badge.svelte";
  import { CHANNEL_LABELS, STATUS_LABELS } from "../lib/format.js";
  import type { Channel, ReleaseStatus } from "../../../src/types.js";

  interface Props {
    channel: Channel;
    status: ReleaseStatus;
    mandatory?: boolean;
    rolloutPercent?: number;
  }

  let { channel, status, mandatory = false, rolloutPercent = 100 }: Props = $props();

  // 상태는 색 + 아이콘 + 텍스트를 함께 쓴다 (규칙 16).
  const STATUS_ICONS = { draft: Circle, published: CircleCheck, archived: CircleSlash };
  const STATUS_TONES = { draft: "neutral", published: "ok", archived: "danger" } as const;

  const StatusIcon = $derived(STATUS_ICONS[status]);
</script>

{#if channel === "beta"}
  <Badge tone="beta"><FlaskConical size={11} />{CHANNEL_LABELS.beta}</Badge>
{:else}
  <Badge tone="neutral">{CHANNEL_LABELS.stable}</Badge>
{/if}

<Badge tone={STATUS_TONES[status]}><StatusIcon size={11} />{STATUS_LABELS[status]}</Badge>

{#if mandatory}
  <Badge tone="warn"><TriangleAlert size={11} />강제</Badge>
{/if}

{#if rolloutPercent < 100}
  <Badge tone="accent" title="단계적 배포 비율"><Percent size={11} />{rolloutPercent}</Badge>
{/if}
