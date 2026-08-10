<script lang="ts">
  import { onMount, type Component, type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  // Standalone windows that render their own chrome and must not pull in the
  // privileged launcher shell (search orchestrator, extension host, ...).
  const BARE_ROUTES = ['/hud', '/sticky', '/snap-guides'];
  let isBare = $state(false);
  let AppShell = $state<Component<{ children: Snippet }> | null>(null);

  onMount(() => {
    if (BARE_ROUTES.includes(window.location.pathname)) {
      isBare = true;
      return;
    }

    void import('../components/layout/AppShell.svelte').then(({ default: component }) => {
      AppShell = component;
    });
  });
</script>

{#if isBare}
  {@render children()}
{:else if AppShell}
  <AppShell {children} />
{/if}
