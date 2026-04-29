<script lang="ts">
  import { onMount } from 'svelte';
  import { emit } from '@tauri-apps/api/event';
  import { Card, Button, EmptyState, LoadingState } from '../../../components';
  import { advanceStep, goBackStep, fetchTopThemes } from '../stepLogic';
  import type { ApiExtension } from '../../../built-in-features/store/state.svelte';
  import storeExtension from '../../../built-in-features/store/index.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { applyTheme, removeTheme } from '../../../services/theme/themeService';
  import { discoverExtensions } from '../../../lib/ipc/commands';
  import { logService } from '../../../services/log/logService';
  import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';

  let themes = $state<ApiExtension[]>([]);
  let loading = $state(true);
  let installingId = $state<number | null>(null);
  // Maps store-API theme name → on-disk manifest.id. Populated as themes are
  // discovered (at load time and after each install). Lets us answer "is this
  // theme installed?" and "is this theme applied?" from the API row.
  let nameToManifestId = $state<Record<string, string>>({});
  // Reactive: re-reads whenever settingsService finishes loading or another
  // window writes the setting via store.onChange. The layout calls init()
  // on mount, but children may render briefly before that completes.
  const activeThemeId = $derived(
    settingsService.currentSettings.appearance.activeTheme ?? null,
  );

  async function refreshDiscovery() {
    try {
      const records = await discoverExtensions();
      const next: Record<string, string> = {};
      for (const r of records) {
        if (r.manifest.type === 'theme') next[r.manifest.name] = r.manifest.id;
      }
      nameToManifestId = next;
    } catch (err) {
      logService.warn(`[onboarding] discoverExtensions failed: ${err}`);
    }
  }

  async function load() {
    loading = true;
    // Defensive: ensure persisted settings are loaded before we render
    // theme tiles. `init()` is idempotent — the layout already calls it.
    await settingsService.init();
    themes = await fetchTopThemes(6);
    await refreshDiscovery();
    loading = false;
  }

  async function install(theme: ApiExtension) {
    installingId = theme.id;
    try {
      await storeExtension.installExtension(theme.slug, theme.id, theme.name);
      await refreshDiscovery();

      const themeId = nameToManifestId[theme.name];
      if (!themeId) {
        logService.warn(`[onboarding] installed theme not found in registry after install: ${theme.name}`);
        diagnosticsService.report({
          source: 'frontend',
          kind: 'manual',
          severity: 'warning',
          retryable: true,
          context: { message: `Couldn't apply ${theme.name} — try again from Settings.` },
        });
        return;
      }

      await applyTheme(themeId);
      await settingsService.updateSettings('appearance', { activeTheme: themeId });
      await emit('asyar:theme-changed', { themeId });
      // activeThemeId is $derived — it re-reads automatically once the
      // store write completes.
    } catch (err) {
      logService.error(`[onboarding] failed to install/apply theme ${theme.name}: ${err}`);
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: `Could not install "${theme.name}"` },
      });
    } finally {
      installingId = null;
    }
  }

  function statusFor(theme: ApiExtension): 'installing' | 'applied' | 'installed' | 'available' {
    if (installingId === theme.id) return 'installing';
    const mid = nameToManifestId[theme.name];
    if (!mid) return 'available';
    if (activeThemeId === mid) return 'applied';
    return 'installed';
  }

  async function useDefault() {
    try {
      removeTheme();
      await settingsService.updateSettings('appearance', { activeTheme: null });
      await emit('asyar:theme-changed', { themeId: null });
      // activeThemeId is $derived — auto-updates from settingsService.
    } catch (err) {
      logService.error(`[onboarding] failed to revert to default theme: ${err}`);
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: 'Could not revert to default theme' },
      });
    }
  }

  onMount(load);
</script>

<Card>
  <h1>Pick a theme</h1>
  <p>Optional — make Asyar feel like home.</p>

  {#if loading}
    <LoadingState message="Loading themes…" />
  {:else if themes.length === 0}
    <EmptyState message="Couldn't load themes.">
      <Button onclick={load}>Retry</Button>
    </EmptyState>
  {:else}
    <ul class="grid">
      <li class="grid__item" class:grid__item--active={activeThemeId === null}>
        <div class="grid__label">
          <span class="grid__name">Default</span>
          <span class="grid__hint">Built-in Asyar theme</span>
        </div>
        {#if activeThemeId === null}
          <span class="grid__status grid__status--applied">Applied</span>
        {:else}
          <Button class="btn-secondary" onclick={useDefault} disabled={installingId !== null}>
            Use default
          </Button>
        {/if}
      </li>

      {#each themes as theme (theme.id)}
        {@const status = statusFor(theme)}
        <li class="grid__item" class:grid__item--active={status === 'applied'}>
          <span class="grid__name">{theme.name}</span>
          {#if status === 'installing'}
            <span class="grid__status">Installing…</span>
          {:else if status === 'applied'}
            <span class="grid__status grid__status--applied">Applied</span>
          {:else}
            <Button onclick={() => install(theme)} disabled={installingId !== null}>
              {status === 'installed' ? 'Apply' : 'Install'}
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="actions">
    <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
    <Button class="btn-secondary" onclick={advanceStep}>Skip</Button>
    <Button onclick={advanceStep}>Continue</Button>
  </div>
</Card>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    margin: var(--space-4) 0;
    padding: 0;
    list-style: none;
  }
  .grid__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--bg-secondary);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    transition: border-color var(--transition-fast);
  }
  .grid__item--active {
    border-color: var(--asyar-brand);
  }
  .grid__label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .grid__name {
    font-weight: 500;
  }
  .grid__hint {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .grid__status {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .grid__status--applied {
    color: var(--asyar-brand);
    font-weight: 600;
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
</style>
