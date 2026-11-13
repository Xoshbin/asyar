<script lang="ts">
  import { emit } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { normalizeShortcut } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import {
    AppearanceThemeSelector,
    Button,
    SegmentedControl,
    Select,
    SettingsCard,
    SettingsRangeSlider,
    SettingsRow,
    ShortcutRecorder,
    Toggle,
    WindowModeSelector,
  } from '../../../components';
  import {
    discoverExtensions,
    getShortcutBackendInfo,
    onboardingCommands,
    type ShortcutBackendInfo,
  } from '../../../lib/ipc/commands';
  import { setUiScale } from '../../../lib/ipc/windowCommands';
  import { clampUiScale, DEFAULT_UI_SCALE, UI_SCALE_OPTIONS } from '../../../lib/launcher/uiScale';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { t } from '../../../services/i18n';
  import { launcherPlacementService } from '../../../services/launcher/launcherPlacementService.svelte';
  import { logService } from '../../../services/log/logService';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { applyTheme, removeTheme } from '../../../services/theme/themeService';
  import { getWaylandBindingGuide } from '../../onboarding/steps/summonSearchSetup';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import type { PopToRootDelay } from '../../../services/settings/types/AppSettingsType';
  import { resolveEscapeBehavior, type EscapeBehavior } from '../../../lib/keyboard/escapeBehavior';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  // Order matches Raycast: navigate-back first, pop-to-root second.
  const escapeOptions = $derived([
    { value: 'go-back', label: t('settings.advanced.escape_back') },
    { value: 'hide-and-reset', label: t('settings.advanced.escape_reset') },
  ]);

  const popToRootOptions = $derived([
    { value: 'immediately', label: t('settings.advanced.pop_to_root_immediately') },
    { value: '10s', label: t('settings.advanced.pop_to_root_10s') },
    { value: '1m', label: t('settings.advanced.pop_to_root_1min') },
    { value: '5m', label: t('settings.advanced.pop_to_root_5min') },
    { value: 'never', label: t('settings.advanced.pop_to_root_never') },
  ]);

  let themeExtensions = $state<
    Array<{ id: string; name: string; author?: string; version: string }>
  >([]);
  let activeThemeId = $state<string | null>(null);
  let selectedUiScale = $state(
    clampUiScale(settingsService.currentSettings.appearance.uiScale ?? DEFAULT_UI_SCALE),
  );
  let shortcutBackendInfo = $state<ShortcutBackendInfo | null>(null);
  let waylandCopied = $state(false);
  const waylandGuide = $derived(getWaylandBindingGuide(shortcutBackendInfo));

  async function copyWaylandCommand() {
    if (!waylandGuide) return;
    try {
      await navigator.clipboard.writeText(waylandGuide.command);
      waylandCopied = true;
    } catch {
      // Clipboard write may fail in restricted environments; ignore.
    }
  }

  onMount(async () => {
    try {
      shortcutBackendInfo = await getShortcutBackendInfo();
    } catch {
      shortcutBackendInfo = { isWayland: false, compositor: null, isOmarchy: false };
    }
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
  const PLACEMENT_ERROR_KEYS: Record<string, string> = {
    display: 'settings.general.error_save_display',
    position: 'settings.general.error_save_position',
    'snap setting': 'settings.general.error_save_snap',
  };

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
        context: {
          message: t(PLACEMENT_ERROR_KEYS[what] ?? 'settings.general.error_save_position'),
        },
      });
    }
  }

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

<SettingsCard>
  <div id="general-startup">
    <SettingsRow
      label={t('settings.general.autostart')}
      description={t('settings.general.autostart_description')}
    >
      <Toggle
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
    {#if waylandGuide}
      <div class="wayland-hotkey-hint">
        <p class="wayland-hotkey-text">
          {t('settings.general.wayland_hotkey_hint', { compositor: waylandGuide.compositorLabel })}
        </p>
        <div class="wayland-hotkey-row">
          <pre class="wayland-hotkey-code"><code>{waylandGuide.command}</code></pre>
          <Button variant="secondary" size="sm" onclick={copyWaylandCommand}>
            {waylandCopied
              ? t('settings.general.wayland_copied')
              : t('settings.general.wayland_copy_cmd')}
          </Button>
        </div>
      </div>
    {/if}
    <SettingsRow
      label={t('settings.general.show_tray_icon')}
      description={handler.settings.general.showTrayIcon
        ? t('settings.general.show_tray_icon_description')
        : t('settings.general.show_tray_icon_tip')}
    >
      <Toggle
        checked={handler.settings.general.showTrayIcon}
        onchange={() => handler.handleTrayIconToggle()}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.general.show_dock_icon')}
      description={t('settings.general.show_dock_icon_description')}
    >
      <Toggle
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

<div class="section-header">{t('settings.general.section_behavior')}</div>
<SettingsCard>
  <div id="advanced-input">
    <SettingsRow
      label={t('settings.advanced.pop_to_root')}
      description={t('settings.advanced.pop_to_root_description')}
    >
      <Select
        value={handler.settings.general?.popToRootDelay ?? '1m'}
        options={popToRootOptions}
        onchange={(value) => handler.updatePopToRootDelay(value as PopToRootDelay)}
      />
    </SettingsRow>
    <SettingsRow
      label={t('settings.advanced.escape_key')}
      description={t('settings.advanced.escape_key_description')}
    >
      <Select
        value={resolveEscapeBehavior(handler.settings.general?.escapeInViewBehavior)}
        options={escapeOptions}
        onchange={(v) => handler.updateEscapeBehavior(v as EscapeBehavior)}
      />
    </SettingsRow>
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
    cursor: default;
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

  .wayland-hotkey-hint {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-6);
    background: var(--bg-tertiary);
    border-top: 1px solid var(--separator);
  }

  .wayland-hotkey-text {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .wayland-hotkey-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .wayland-hotkey-code {
    flex: 1;
    margin: 0;
    padding: var(--space-2);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    overflow-x: auto;
  }
</style>
