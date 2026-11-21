<script lang="ts">
  import { emit } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import {
    AppearanceThemeSelector,
    ListDensitySettings,
    ThemePicker,
    Select,
    SettingsCard,
    SettingsRow,
    Toggle,
    WindowModeSelector,
  } from '../../../components';
  import { discoverExtensions } from '../../../lib/ipc/commands';
  import { setUiScale } from '../../../lib/ipc/windowCommands';
  import { clampUiScale, DEFAULT_UI_SCALE, UI_SCALE_OPTIONS } from '../../../lib/launcher/uiScale';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { t } from '../../../services/i18n';
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
  let selectedUiScale = $state(
    clampUiScale(settingsService.currentSettings.appearance.uiScale ?? DEFAULT_UI_SCALE),
  );

  onMount(async () => {
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

  async function selectLaunchView(launchView: 'default' | 'compact') {
    await handler.updateLaunchView(launchView);
    await emit('asyar:launch-view-changed', { launchView });
  }

  async function selectUiScale(scale: number) {
    const clampedScale = clampUiScale(scale);
    const previousScale = selectedUiScale;
    selectedUiScale = clampedScale;

    let saved: boolean;
    try {
      saved = await settingsService.updateSettings('appearance', { uiScale: clampedScale });
    } catch {
      settingsService.currentSettings.appearance.uiScale = previousScale;
      selectedUiScale = previousScale;
      reportUiScaleError();
      return;
    }

    if (!saved) {
      settingsService.currentSettings.appearance.uiScale = previousScale;
      selectedUiScale = previousScale;
      reportUiScaleError();
      return;
    }

    try {
      await setUiScale(clampedScale);
    } catch {
      reportUiScaleError();
    }
  }

  function reportUiScaleError() {
    logService.error('Failed to update interface size');
    feedbackService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'error',
      retryable: false,
      context: { message: t('settings.general.error_save_interface_size') },
    });
  }

  function getMoreThemes() {
    void emit('asyar:run-command', { commandId: 'cmd_store_browse', args: { filter: 'themes' } });
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

<SettingsCard>
  <div id="appearance">
    <SettingsRow
      label={t('settings.appearance.mode')}
      description={t('settings.general.theme_description')}
    >
      <AppearanceThemeSelector
        value={handler.selectedTheme as 'light' | 'dark' | 'system'}
        onchange={(v) => handler.updateThemeSetting(v)}
        wellBackground="secondary"
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.appearance.theme')}
      description={t('settings.appearance.theme_picker_description')}
    >
      {#snippet below()}
        <ThemePicker
          themes={themeExtensions}
          activeId={activeThemeId}
          onselect={selectTheme}
          ongetmore={getMoreThemes}
        />
      {/snippet}
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
    <SettingsRow
      label={t('settings.appearance.interface_size_label')}
      description={t('settings.appearance.interface_size_hint')}
    >
      <Select
        value={String(selectedUiScale)}
        options={UI_SCALE_OPTIONS.map((option) => ({
          value: String(option.value),
          label: t(option.labelKey),
        }))}
        onchange={(value) => selectUiScale(Number(value))}
      />
    </SettingsRow>
    <ListDensitySettings />
    {#if handler.selectedLaunchView === 'compact'}
      <SettingsRow
        label={t('settings.appearance.hide_show_more')}
        description={t('settings.appearance.hide_show_more_description')}
      >
        <Toggle
          checked={!!handler.settings.appearance.hideCompactShowMore}
          onchange={() =>
            settingsService.updateSettings('appearance', {
              hideCompactShowMore: !handler.settings.appearance.hideCompactShowMore,
            })}
        />
      </SettingsRow>
    {/if}
    <SettingsRow
      label={t('settings.appearance.show_running_indicator')}
      description={t('settings.appearance.show_running_indicator_description')}
    >
      <Toggle
        checked={!handler.settings.appearance.hideRunningIndicator}
        onchange={() =>
          settingsService.updateSettings('appearance', {
            hideRunningIndicator: !handler.settings.appearance.hideRunningIndicator,
          })}
      />
    </SettingsRow>
  </div>
</SettingsCard>
