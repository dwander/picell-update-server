<script lang="ts">
  import { KeyRound } from "lucide-svelte";
  import { api } from "../lib/api.js";
  import Button from "../components/Button.svelte";

  interface Props {
    authConfigured: boolean;
    onsuccess: () => void;
  }

  let { authConfigured, onsuccess }: Props = $props();

  let password = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!password || busy) return;
    busy = true;
    error = "";
    try {
      await api.login(password);
      onsuccess();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      password = "";
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <div class="mb-6 text-center">
      <div
        class="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-accent/12 text-accent"
      >
        <KeyRound size={20} />
      </div>
      <h1 class="text-base font-semibold text-ink">PiCell 업데이트 콘솔</h1>
      <p class="mt-1 text-xs text-ink-faint">배포 관리 전용</p>
    </div>

    {#if !authConfigured}
      <div class="rounded-xl border border-warn/40 bg-warn/8 p-4 text-xs whitespace-pre-line text-warn">
        {"ADMIN_PASSWORD 환경변수가 설정되지 않아 콘솔이 비활성화되어 있습니다.\nRailway 변수에 ADMIN_PASSWORD를 추가한 뒤 다시 배포하세요."}
      </div>
    {:else}
      <form onsubmit={submit} class="rounded-xl border border-line bg-surface-1 p-4">
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-ink-muted">비밀번호</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="password"
            autofocus
            autocomplete="current-password"
            bind:value={password}
            class="w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>

        {#if error}
          <p class="mt-2 text-xs text-danger">{error}</p>
        {/if}

        <Button type="submit" variant="primary" loading={busy} class="mt-4 w-full justify-center">
          로그인
        </Button>
      </form>
    {/if}
  </div>
</div>
