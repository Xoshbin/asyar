<script lang="ts">
  import { emit } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { normalizeShortcut } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import {
    AppearanceThemeSelector,
    Button,
    Checkbox,
    SegmentedControl,
    SettingsCard,
    SettingsRangeSlider,
    SettingsRow,
    ShortcutRecorder,
    Toggle,
    WindowModeSelector,
  } from '../../../components';
  import { discoverExtensions, onboardingCommands } from '../../../lib/ipc/commands';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { t } from '../../../services/i18n';
  import { launcherPlacementService } from '../../../services/launcher/launcherPlacementService.svelte';
  import { logService } from '../../../services/log/logService';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { applyTheme, removeTheme } from '../../../services/theme/themeService';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let themeExtensions = $state<
    Array<{ id: string; name: string; author?: string; version: string }>
  >([]);
  let activeThemeId = $state<string | null>(null);

  onMount(async () => {
    // Separate from the theme-extension load below: Rust owns the placement,
    // so a failure there must not blank the placement controls (and vice
    // versa).
    try {
      await launcherPlacementService.load();
    } catch (e) {
      logService.error(`Failed to load launcher placement: ${e}`);
    }

    try {
      const records = await discoverExtensions();
      themeExtensions = (records ?? [])
        .filter((r: any) => r.manifest.type === 'theme' && r.enabled)
        .map((r: any) => ({
          id: r.manifest.id,
          name: r.manifest.name,
          author: r.manifest.author ?? undefined,
          version: r.manifest.version,
        }));
      activeThemeId = handler.settings?.appearance?.activeTheme ?? null;
    } catch (e) {
      logService.error(`Failed to load theme extensions: ${e}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: t('settings.general.error_load_themes') },
      });
    }
  });

  async function conflictChecker(shortcut: string): Promise<{ name: string } | null> {
    const conflict = await shortcutService.isConflict(normalizeShortcut(shortcut), 'launcher');
    if (conflict) return { name: conflict.itemName };
    return null;
  }

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    handler.selectedModifier = detail.modifier;
    handler.selectedKey = detail.key;
    handler.isSaving = true;
    handler.saveMessage = '';
    handler.saveError = false;

    try {
      const { updateShortcut } = await import('../../../utils/shortcutManager');
      const success = await updateShortcut(detail.modifier, detail.key);
      handler.isSaving = false;
      if (success) return true;
      return 'Cannot save, shortcut may be reserved by the OS or another app';
    } catch (e) {
      handler.isSaving = false;
      return 'Cannot save, shortcut may be reserved by the OS or another app';
    }
  }

  const placement = launcherPlacementService;

  /** Each placement edit is one store write. Persist-then-adopt lives in the
   *  service, so a failure leaves the previous choice selected rather than a
   *  setting that isn't on disk. */
  async function updatePlacement(change: () => Promise<void>, what: string) {
    try {
      await change();
    } catch (error) {
      logService.error(`Failed to update launcher ${what}: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not save the launcher ${what}` },
      });
    }
  }

  async function selectLaunchView(launchView: 'default' | 'compact') {
    await handler.updateLaunchView(launchView);
    await emit('asyar:launch-view-changed', { launchView });
  }

  async function rerunOnboarding() {
    try {
      await onboardingCommands.reset();
    } catch (e) {
      logService.error(`Failed to re-run onboarding: ${e}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('settings.general.error_rerun_onboarding') },
      });
    }
  }

  async function selectTheme(themeId: string | null) {
    try {
      if (themeId) {
        await applyTheme(themeId);
      } else {
        removeTheme();
      }
      activeThemeId = themeId;
      await settingsService.updateSettings('appearance', { activeTheme: themeId });
      await emit('asyar:theme-changed', { themeId });
    } catch (error) {
      logService.error(`Failed to apply theme ${themeId}: ${error}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: {
          message: themeId
            ? `Could not apply theme "${themeId}"`
            : t('settings.general.error_remove_active_theme'),
        },
      });
    }
  }
</script>

<div class="section-header">{t('settings.general.section_startup')}</div>
<SettingsCard>
  <div id="general-startup">
    <SettingsRow
      label={t('settings.general.autostart')}
      description={t('settings.general.autostart_description')}
    >
      <Checkbox
        checked={handler.settings.general.startAtLogin}
        onchange={() => handler.handleAutostartToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.general.hotkey')}
      description={t('settings.general.hotkey_description')}
    >
      <ShortcutRecorder
        bind:modifier={handler.selectedModifier}
        bind:key={handler.selectedKey}
        placeholder={t('settings.general.hotkey_placeholder')}
        disabled={handler.isSaving}
        onsave={handleSave}
        {conflictChecker}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.general.show_tray_icon')}
      description={handler.settings.general.showTrayIcon
        ? t('settings.general.show_tray_icon_description')
        : t('settings.general.show_tray_icon_tip')}
    >
      <Checkbox
        checked={handler.settings.general.showTrayIcon}
        onchange={() => handler.handleTrayIconToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.general.show_dock_icon')}
      description={t('settings.general.show_dock_icon_description')}
    >
      <Checkbox
        checked={handler.settings.general.showDockIcon}
        onchange={() => handler.handleDockIconToggle()}
      />
    </SettingsRow>
  </div>
</SettingsCard>

<div class="section-header">{t('settings.general.section_appearance')}</div>
<SettingsCard>
  <div id="general-appearance">
    <SettingsRow
      label={t('settings.appearance.theme')}
      description={t('settings.general.theme_description')}
    >
      <AppearanceThemeSelector
        value={handler.selectedTheme as 'light' | 'dark' | 'system'}
        onchange={(v) => handler.updateThemeSetting(v)}
        wellBackground="secondary"
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.appearance.window_mode')}
      description={t('settings.appearance.window_mode_description')}
    >
      <WindowModeSelector
        value={handler.selectedLaunchView}
        onchange={selectLaunchView}
        wellBackground="primary"
      />
    </SettingsRow>
  </div>
</SettingsCard>

<div class="section-header">{t('settings.general.section_placement')}</div>
<SettingsCard>
  <div id="general-placement">
    <SettingsRow
      label={t('settings.general.display')}
      description={t('settings.general.display_description')}
    >
      <SegmentedControl
        options={[
          { value: 'cursor', label: t('settings.general.display_cursor') },
          { value: 'primary', label: t('settings.general.display_primary') },
        ]}
        value={placement.placement.monitor}
        onchange={(v) =>
          updatePlacement(() => placement.setMonitor(v as 'cursor' | 'primary'), 'display')}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.general.vertical_position')}
      description={t('settings.general.vertical_position_description')}
    >
      <SegmentedControl
        options={[
          { value: 'top', label: t('settings.general.vertical_top') },
          { value: 'center', label: t('settings.general.vertical_center') },
          { value: 'custom', label: t('settings.general.vertical_custom') },
        ]}
        value={placement.vertical ?? ''}
        onchange={(v) =>
          updatePlacement(
            () => placement.setVertical(v as 'top' | 'center' | 'custom'),
            'position',
          )}
      />
    </SettingsRow>
    {#if placement.vertical === 'custom'}
      <SettingsRow label={t('settings.general.distance_from_top')}>
        <SettingsRangeSlider
          min={0}
          max={100}
          value={placement.biasPercent}
          suffix="%"
          onchange={(v) => updatePlacement(() => placement.setBias(v), 'position')}
        />
      </SettingsRow>
    {/if}
    <SettingsRow
      label={t('settings.general.snap_dragging')}
      description={t('settings.general.snap_dragging_description')}
    >
      <Toggle
        checked={placement.placement.snapEnabled}
        onchange={() =>
          updatePlacement(
            () => placement.setSnapEnabled(!placement.placement.snapEnabled),
            'snap setting',
          )}
      />
    </SettingsRow>
    {#if placement.isDragged}
      <SettingsRow
        label={t('settings.general.custom_position')}
        description={t('settings.general.custom_position_description')}
      >
        <Button
          class="btn-secondary"
          onclick={() => updatePlacement(() => placement.reset(), 'position')}
        >
          {t('settings.general.reset')}
        </Button>
      </SettingsRow>
    {/if}
  </div>
</SettingsCard>

<SettingsCard>
  <div id="general-onboarding">
    <SettingsRow
      label={t('settings.general.onboarding')}
      description={t('settings.general.onboarding_description')}
    >
      <Button class="btn-secondary" onclick={rerunOnboarding}
        >{t('settings.general.rerun_onboarding')}</Button
      >
    </SettingsRow>
  </div>
</SettingsCard>

{#if themeExtensions.length > 0}
  <div class="section-header">{t('settings.general.custom_themes')}</div>
  <SettingsCard>
    <div class="themes-list">
      <label class="theme-item" class:theme-active={activeThemeId === null}>
        <input
          type="radio"
          name="custom-theme"
          checked={activeThemeId === null}
          onchange={() => selectTheme(null)}
          class="sr-only"
        />
        <div class="theme-item-body">
          <div class="theme-item-name">{t('settings.general.default_theme')}</div>
          <div class="theme-item-meta">{t('settings.general.default_theme_meta')}</div>
        </div>
      </label>

      {#each themeExtensions as theme}
        <label class="theme-item" class:theme-active={activeThemeId === theme.id}>
          <input
            type="radio"
            name="custom-theme"
            checked={activeThemeId === theme.id}
            onchange={() => selectTheme(theme.id)}
            class="sr-only"
          />
          <div class="theme-item-body">
            <div class="theme-item-name">{theme.name}</div>
            <div class="theme-item-meta">
              {#if theme.author}{theme.author} &middot;
              {/if}v{theme.version}
            </div>
          </div>
        </label>
      {/each}
    </div>
  </SettingsCard>
{/if}

<style>
  .themes-list {
    display: flex;
    flex-direction: column;
  }

  .theme-item {
    position: relative;
    display: flex;
    align-items: center;
    padding: var(--space-5) var(--space-6);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .theme-item:not(:last-child)::after {
    content: '';
    position: absolute;
    left: var(--space-6);
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--border-color);
  }

  .theme-item:hover {
    background: var(--bg-hover);
  }

  .theme-item.theme-active .theme-item-name {
    color: var(--accent-primary);
  }

  .theme-item-body {
    flex: 1;
  }

  .theme-item-name {
    font-weight: 500;
    font-size: var(--font-size-md);
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .theme-item-meta {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    margin-top: var(--space-1);
  }
</style>
