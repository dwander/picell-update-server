<script lang="ts">
  import { onMount } from "svelte";
  import {
    Boxes,
    Database,
    CircleGauge,
    LogOut,
    ScrollText,
    Settings2,
    TrendingUp,
  } from "lucide-svelte";
  import { api } from "./lib/api.js";
  import { navigate, router } from "./lib/router.svelte.js";
  import { toasts } from "./lib/ui.svelte.js";
  import Toasts from "./components/Toasts.svelte";
  import ConfirmDialog from "./components/ConfirmDialog.svelte";
  import Login from "./routes/Login.svelte";
  import Dashboard from "./routes/Dashboard.svelte";
  import Releases from "./routes/Releases.svelte";
  import ReleaseDetail from "./routes/ReleaseDetail.svelte";
  import Changelog from "./routes/Changelog.svelte";
  import Stats from "./routes/Stats.svelte";
  import Storage from "./routes/Storage.svelte";
  import Tools from "./routes/Tools.svelte";

  const NAV = [
    { section: "dashboard", path: "/dashboard", label: "대시보드", icon: CircleGauge },
    { section: "releases", path: "/releases", label: "릴리즈", icon: Boxes },
    { section: "changelog", path: "/changelog", label: "체인지로그", icon: ScrollText },
    { section: "stats", path: "/stats", label: "통계", icon: TrendingUp },
    { section: "storage", path: "/storage", label: "스토리지", icon: Database },
    { section: "tools", path: "/tools", label: "도구", icon: Settings2 },
  ];

  let authenticated = $state(false);
  let authConfigured = $state(true);
  let ready = $state(false);
  let serverConfig = $state<{ storageConfigured: boolean; bucket: string; keyPrefix: string } | null>(
    null,
  );

  async function bootstrap(): Promise<void> {
    try {
      const session = await api.session();
      authenticated = session.authenticated;
      authConfigured = session.authConfigured;
      if (authenticated) serverConfig = await api.config();
    } catch (e) {
      toasts.error(e);
    } finally {
      ready = true;
    }
  }

  async function onLoggedIn(): Promise<void> {
    authenticated = true;
    serverConfig = await api.config().catch(() => null);
  }

  async function logout(): Promise<void> {
    await api.logout().catch(() => undefined);
    authenticated = false;
    serverConfig = null;
  }

  onMount(bootstrap);

  const route = $derived(router.current);
</script>

<Toasts />
<ConfirmDialog />

{#if !ready}
  <div class="flex min-h-screen items-center justify-center">
    <span class="size-6 animate-spin rounded-full border-2 border-line-strong border-t-accent"
    ></span>
  </div>
{:else if !authenticated}
  <Login {authConfigured} onsuccess={onLoggedIn} />
{:else}
  <div class="flex min-h-screen">
    <aside class="flex w-52 shrink-0 flex-col border-r border-line bg-surface-1">
      <div class="border-b border-line px-4 py-4">
        <p class="text-sm font-semibold text-ink">PiCell 업데이트</p>
        <p class="mt-0.5 font-mono text-xs text-ink-faint">
          {serverConfig?.bucket || "R2 미설정"}{serverConfig?.keyPrefix
            ? ` · ${serverConfig.keyPrefix}`
            : ""}
        </p>
      </div>

      <nav class="flex-1 space-y-0.5 p-2">
        {#each NAV as item (item.section)}
          {@const active = route.section === item.section}
          <a
            href={router.href(item.path)}
            onclick={(e) => navigate(e, item.path)}
            class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors {active
              ? 'bg-accent/12 font-medium text-accent'
              : 'text-ink-muted hover:bg-surface-3 hover:text-ink'}"
          >
            <item.icon size={15} />
            {item.label}
          </a>
        {/each}
      </nav>

      <div class="border-t border-line p-2">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink"
          onclick={logout}
        >
          <LogOut size={15} />
          로그아웃
        </button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-x-hidden">
      <div class="mx-auto max-w-6xl px-6 py-6">
        {#if route.section === "releases" && route.param}
          <ReleaseDetail releaseId={route.param} />
        {:else if route.section === "releases"}
          <Releases />
        {:else if route.section === "changelog"}
          <Changelog />
        {:else if route.section === "stats"}
          <Stats />
        {:else if route.section === "storage"}
          <Storage />
        {:else if route.section === "tools"}
          <Tools />
        {:else}
          <Dashboard />
        {/if}
      </div>
    </main>
  </div>
{/if}
