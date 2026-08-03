<script lang="ts">
  import Modal from "./Modal.svelte";
  import Button from "./Button.svelte";
  import { confirms } from "../lib/ui.svelte.js";

  const request = $derived(confirms.request);
</script>

<Modal
  title={request?.title ?? ""}
  open={request !== null}
  onclose={() => confirms.answer(false)}
>
  <p class="text-sm whitespace-pre-line text-ink-muted">{request?.body ?? ""}</p>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => confirms.answer(false)}>취소</Button>
    <Button
      variant={request?.danger ? "danger" : "primary"}
      onclick={() => confirms.answer(true)}
    >
      {request?.confirmLabel ?? "확인"}
    </Button>
  {/snippet}
</Modal>
