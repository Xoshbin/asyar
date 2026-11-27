<script lang="ts">
  import { onMount } from 'svelte';
  import { emit } from '@tauri-apps/api/event';
  import {
    Card,
    Button,
    LoadingState,
    AppearanceThemeSelector,
    ThemePicker,
    WindowModeSelector,
  } from '../../../components';
  import { advanceStep, goBackStep, fetchTopThemes } from '../stepLogic';
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
  import { appListen } from '../../../lib/ipc/bridgeEvents';

  let {
    onDone = advanceStep,
    onBack = goBackStep,
  }: { onDone?: () => void | Promise<void>; onBack?: () => void | Promise<void> } = $props();

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
        context: { message: t('onboarding.theme_install_failed', { name: theme.name }) },
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
        context: { message: t('onboarding.theme_apply_failed', { name: theme.name }) },
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

  const cards = $derived(
    themes.map((theme) => {
      const installedId = getInstalledThemeId(theme);
      return {
        theme,
        id: installedId ?? theme.manifest?.id ?? String(theme.id),
        name: theme.name,
        author: theme.author?.name,
        meta: installingId === theme.id ? t('common.installing') : undefined,
        installed: installedId !== null,
      };
    }),
  );
  const activeCardId = $derived(
    activeThemeId === null
      ? null
      : (cards.find((c) => statusFor(c.theme) === 'applied')?.id ?? activeThemeId),
  );

  function selectTheme(id: string | null) {
    if (installingId !== null || id === activeCardId) return;
    if (id === null) return void useDefault();
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    if (card.installed) void apply(card.theme);
    else void install(card.theme);
  }

  const currentMode = $derived(settingsService.currentSettings.appearance.theme);
  const currentLaunchView = $derived(settingsService.currentSettings.appearance.launchView);

  async function pickMode(theme: 'light' | 'dark' | 'system') {
    await settingsService.updateSettings('appearance', { theme });
  }

  async function pickLaunchView(launchView: 'default' | 'compact') {
    await settingsService.updateSettings('appearance', { launchView });
    await emit('asyar:launch-view-changed', { launchView });
  }

  $effect(() => {
    onboardingNav.set({
      glyph: 'palette',
      showSkip: true,
      onPrimary: onDone,
      onSkip: onDone,
      onBack,
    });
  });

  onMount(() => {
    let unlistenUpdated: (() => void) | undefined;
    let unlistenThemeChanged: (() => void) | undefined;
    void load();

    try {
      void appListen('extensions_updated', () => {
        void refreshDiscovery();
      }).then((fn) => {
        unlistenUpdated = fn;
      });
      void appListen('asyar:theme-changed', () => {
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

  <div class="look__row">
    <div class="look__label">
      <span class="look__title">{t('onboarding.tour_appearance')}</span>
    </div>
    <AppearanceThemeSelector value={currentMode} onchange={pickMode} />
  </div>
  <div class="look__row">
    <div class="look__label">
      <span class="look__title">{t('onboarding.tour_window_mode')}</span>
    </div>
    <WindowModeSelector value={currentLaunchView} onchange={pickLaunchView} />
  </div>

  {#if loading}
    <LoadingState message={t('common.loading')} />
  {:else}
    <div class="themes">
      <ThemePicker themes={cards} activeId={activeCardId} onselect={selectTheme} />
    </div>

    {#if themes.length === 0}
      <div class="theme-empty">
        <span class="theme-empty__hint">{t('onboarding.theme_load_error')}</span>
        <Button class="btn-secondary" onclick={load}>{t('common.retry')}</Button>
      </div>
    {/if}
  {/if}
</Card>

<style>
  .look__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--separator);
  }
  .look__label {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
  }
  .look__title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .themes {
    margin: var(--space-4) 0;
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
