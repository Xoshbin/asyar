<script lang="ts">
  import { onMount } from 'svelte';
  import { emit, listen } from '@tauri-apps/api/event';
  import { Card, Button, LoadingState } from '../../../components';
  import { advanceStep, fetchTopThemes } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import type { ApiExtension } from '../../../built-in-features/store/state.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { removeTheme } from '../../../services/theme/themeService';
  import { discoverExtensions, listInstalledExtensions } from '../../../lib/ipc/commands';
  import { logService } from '../../../services/log/logService';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { t } from '../../../services/i18n';
  import { applyInstalledTheme, installThemeExtension } from './themeSetup';
  import { isExtensionInstalled } from '../../../lib/installedExtensions';

  let themes = $state<ApiExtension[]>([]);
  let loading = $state(true);
  let installingId = $state<string | number | null>(null);
  let installedPaths = $state<string[]>([]);
  // Maps store-API theme name/id → on-disk manifest.id. Populated as themes are
  // discovered (at load time and after each install). Lets us answer "is this
  // theme installed?" and "is this theme applied?" from the API row.
  let nameToManifestId = $state<Record<string, string>>({});
  // Reactive: re-reads whenever settingsService finishes loading or another
  // window writes the setting via store.onChange. The layout calls init()
  // on mount, but children may render briefly before that completes.
  const activeThemeId = $derived(settingsService.currentSettings.appearance.activeTheme ?? null);

  async function refreshDiscovery() {
    try {
      const [records, paths] = await Promise.all([discoverExtensions(), listInstalledExtensions()]);
      if (paths) {
        installedPaths = paths;
      }
      if (records) {
        const next: Record<string, string> = {};
        for (const r of records) {
          if (r.manifest.type === 'theme') {
            next[r.manifest.name] = r.manifest.id;
            if (r.manifest.id) next[r.manifest.id] = r.manifest.id;
          }
        }
        nameToManifestId = next;
      }
    } catch (err) {
      logService.warn(`[onboarding] refreshDiscovery failed: ${err}`);
    }
  }

  function getInstalledThemeId(theme: ApiExtension): string | null {
    if (theme.manifest?.id && nameToManifestId[theme.manifest.id]) {
      return nameToManifestId[theme.manifest.id];
    }
    if (theme.id && nameToManifestId[String(theme.id)]) {
      return nameToManifestId[String(theme.id)];
    }
    if (theme.name && nameToManifestId[theme.name]) {
      return nameToManifestId[theme.name];
    }
    if (theme.slug && nameToManifestId[theme.slug]) {
      return nameToManifestId[theme.slug];
    }
    if (isExtensionInstalled(theme, installedPaths)) {
      return theme.manifest?.id ?? (typeof theme.id === 'string' ? theme.id : null);
    }
    return null;
  }

  async function load() {
    loading = true;
    // Defensive: ensure persisted settings are loaded before we render
    // theme tiles. `init()` is idempotent — the layout already calls it.
    await settingsService.init();
    try {
      themes = await fetchTopThemes(6);
    } finally {
      await refreshDiscovery();
      loading = false;
    }
  }

  async function install(theme: ApiExtension) {
    installingId = theme.id;
    try {
      await installThemeExtension(theme);
      await refreshDiscovery();
      const themeId =
        getInstalledThemeId(theme) ||
        theme.manifest?.id ||
        (typeof theme.id === 'string' ? theme.id : null);
      if (themeId) {
        await applyInstalledTheme(themeId);
      }
    } catch (err) {
      logService.error(`[onboarding] failed to install theme ${theme.name}: ${err}`);
      feedbackService.report({
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

  async function apply(theme: ApiExtension) {
    const themeId =
      getInstalledThemeId(theme) ||
      theme.manifest?.id ||
      (typeof theme.id === 'string' ? theme.id : null);
    if (!themeId) return;
    try {
      await applyInstalledTheme(themeId);
    } catch (err) {
      logService.error(`[onboarding] failed to apply theme ${theme.name}: ${err}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: `Could not apply "${theme.name}"` },
      });
    }
  }

  function statusFor(theme: ApiExtension): 'installing' | 'applied' | 'installed' | 'available' {
    if (installingId === theme.id) return 'installing';
    const mid = getInstalledThemeId(theme);
    const candidateIds = [mid, theme.manifest?.id, theme.id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
    if (candidateIds.some((id) => activeThemeId === id)) return 'applied';
    if (!mid) return 'available';
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
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: t('settings.general.error_revert_default') },
      });
    }
  }

  $effect(() => {
    onboardingNav.set({ showSkip: true, onPrimary: advanceStep, onSkip: advanceStep });
  });

  onMount(() => {
    let unlistenUpdated: (() => void) | undefined;
    let unlistenThemeChanged: (() => void) | undefined;
    void load();

    try {
      void listen('extensions_updated', () => {
        void refreshDiscovery();
      }).then((fn) => {
        unlistenUpdated = fn;
      });
      void listen('asyar:theme-changed', () => {
        void refreshDiscovery();
      }).then((fn) => {
        unlistenThemeChanged = fn;
      });
    } catch {}

    const onStoreEvent = () => {
      void refreshDiscovery();
    };
    window.addEventListener('store-extension-installed', onStoreEvent);
    window.addEventListener('store-extension-uninstalled', onStoreEvent);

    return () => {
      if (unlistenUpdated) unlistenUpdated();
      if (unlistenThemeChanged) unlistenThemeChanged();
      window.removeEventListener('store-extension-installed', onStoreEvent);
      window.removeEventListener('store-extension-uninstalled', onStoreEvent);
    };
  });
</script>

<Card>
  <h1>{t('onboarding.theme_heading')}</h1>
  <p>{t('onboarding.theme_desc')}</p>

  {#if loading}
    <LoadingState message={t('common.loading')} />
  {:else}
    <ul class="grid">
      <li class="grid__item" class:grid__item--active={activeThemeId === null}>
        <div
          class="grid__tile"
          role="button"
          tabindex="0"
          onclick={() => {
            if (installingId !== null || activeThemeId === null) return;
            void useDefault();
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (installingId !== null || activeThemeId === null) return;
              void useDefault();
            }
          }}
        >
          <div class="grid__label">
            <span class="grid__name">{t('settings.general.default_theme')}</span>
            <span class="grid__hint">{t('settings.general.default_theme_meta')}</span>
          </div>
          {#if activeThemeId === null}
            <span class="grid__status grid__status--applied">{t('settings.general.applied')}</span>
          {:else}
            <Button
              class="btn-secondary"
              onclick={(e: MouseEvent) => {
                e.stopPropagation();
                void useDefault();
              }}
              disabled={installingId !== null}
            >
              {t('settings.general.use_default')}
            </Button>
          {/if}
        </div>
      </li>

      {#each themes as theme (theme.id)}
        {@const status = statusFor(theme)}
        <li class="grid__item" class:grid__item--active={status === 'applied'}>
          <div
            class="grid__tile"
            role="button"
            tabindex="0"
            onclick={() => {
              if (installingId !== null || status === 'applied') return;
              if (status === 'installed') {
                void apply(theme);
              } else {
                void install(theme);
              }
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (installingId !== null || status === 'applied') return;
                if (status === 'installed') void apply(theme);
                else void install(theme);
              }
            }}
          >
            <div class="grid__label">
              <span class="grid__name">{theme.name}</span>
              {#if theme.description}
                <span class="grid__hint" title={theme.description}>{theme.description}</span>
              {/if}
            </div>
            {#if status === 'installing'}
              <span class="grid__status">{t('common.installing')}</span>
            {:else if status === 'applied'}
              <span class="grid__status grid__status--applied">{t('settings.general.applied')}</span
              >
            {:else}
              <Button
                onclick={(e: MouseEvent) => {
                  e.stopPropagation();
                  if (status === 'installed') void apply(theme);
                  else void install(theme);
                }}
                disabled={installingId !== null}
              >
                {status === 'installed' ? t('common.apply') : t('common.install')}
              </Button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>

    {#if themes.length === 0}
      <div class="theme-empty">
        <span class="theme-empty__hint">{t('onboarding.theme_load_error')}</span>
        <Button class="btn-secondary" onclick={load}>{t('common.retry')}</Button>
      </div>
    {/if}
  {/if}
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
    padding: 0;
    background: var(--bg-secondary);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    transition: all var(--transition-fast);
  }
  .grid__item:hover {
    background: var(--bg-hover);
  }
  .grid__item--active {
    border-color: var(--asyar-brand);
  }
  .grid__tile {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
    user-select: none;
    outline: none;
  }
  .grid__item--active .grid__tile {
    cursor: default;
  }
  .grid__tile:focus-visible {
    box-shadow: var(--shadow-focus);
  }
  .grid__label {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    flex: 1 1 0%;
    min-width: 0;
    overflow: hidden;
  }
  .grid__name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid__hint {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid__status {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .grid__status--applied {
    color: var(--asyar-brand);
    font-weight: 600;
  }
  .grid__tile :global(.btn) {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .theme-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    margin-top: var(--space-3);
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
  }
  .theme-empty__hint {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
</style>
