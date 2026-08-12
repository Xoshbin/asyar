<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsCard,
    SettingsRow,
    SettingsPaneHeader,
    Checkbox,
    ShortcutRecorder,
    AppearanceThemeSelector,
    WindowModeSelector,
    Button,
    SegmentedControl,
    SettingsRangeSlider,
    Toggle,
  } from '../../../components';
  import { launcherPlacementService } from '../../../services/launcher/launcherPlacementService.svelte';
  import { onboardingCommands } from '../../../lib/ipc/commands';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { normalizeShortcut } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import { applyTheme, removeTheme } from '../../../services/theme/themeService';
  import { discoverExtensions } from '../../../lib/ipc/commands';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { emit } from '@tauri-apps/api/event';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { logService } from '../../../services/log/logService';

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
        context: { message: 'Could not load theme extensions list' },
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
        context: { message: 'Could not re-run onboarding' },
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
          message: themeId ? `Could not apply theme "${themeId}"` : 'Could not remove active theme',
        },
      });
    }
  }
</script>

<SettingsPaneHeader title="General" subtitle="How Asyar starts, looks, and where it appears." />

<div class="section-header">Startup</div>
<SettingsCard>
  <div id="general-startup">
    <SettingsRow
      label="Launch Asyar at login"
      description="Asyar starts in the background when you sign in."
    >
      <Checkbox
        checked={handler.settings.general.startAtLogin}
        onchange={() => handler.handleAutostartToggle()}
      />
    </SettingsRow>
    <SettingsRow label="Global hotkey" description="Summon the launcher from any app.">
      <ShortcutRecorder
        bind:modifier={handler.selectedModifier}
        bind:key={handler.selectedKey}
        placeholder="Click to set shortcut"
        disabled={handler.isSaving}
        onsave={handleSave}
        {conflictChecker}
      />
    </SettingsRow>
  </div>
</SettingsCard>

<div class="section-header">Appearance</div>
<SettingsCard>
  <div id="general-appearance">
    <SettingsRow label="Theme" description="Match the system or lock one appearance.">
      <AppearanceThemeSelector
        value={handler.selectedTheme as 'light' | 'dark' | 'system'}
        onchange={(v) => handler.updateThemeSetting(v)}
        wellBackground="secondary"
      />
    </SettingsRow>
    <SettingsRow
      label="Window mode"
      description="How much of the launcher is visible before you type."
    >
      <WindowModeSelector
        value={handler.selectedLaunchView}
        onchange={selectLaunchView}
        wellBackground="primary"
      />
    </SettingsRow>
  </div>
</SettingsCard>

<div class="section-header">Placement</div>
<SettingsCard>
  <div id="general-placement">
    <SettingsRow label="Display" description="Which screen the launcher opens on.">
      <SegmentedControl
        options={[
          { value: 'cursor', label: 'Display with cursor' },
          { value: 'primary', label: 'Primary display' },
        ]}
        value={placement.placement.monitor}
        onchange={(v) =>
          updatePlacement(() => placement.setMonitor(v as 'cursor' | 'primary'), 'display')}
      />
    </SettingsRow>
    <SettingsRow
      label="Vertical position"
      description="Drag the launcher itself to set a custom spot."
    >
      <SegmentedControl
        options={[
          { value: 'top', label: 'Top' },
          { value: 'center', label: 'Centre' },
          { value: 'custom', label: 'Custom' },
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
      <SettingsRow label="Distance from top">
        <SettingsRangeSlider
          min={0}
          max={100}
          value={placement.biasPercent}
          suffix="%"
          onchange={(v) => updatePlacement(() => placement.setBias(v), 'position')}
        />
      </SettingsRow>
    {/if}
    <SettingsRow label="Snap while dragging" description="Snap to screen edges and centre lines.">
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
        label="Custom position"
        description="Set by dragging the launcher. Stored relative to the display."
      >
        <Button
          class="btn-secondary"
          onclick={() => updatePlacement(() => placement.reset(), 'position')}
        >
          Reset
        </Button>
      </SettingsRow>
    {/if}
  </div>
</SettingsCard>

<SettingsCard>
  <div id="general-onboarding">
    <SettingsRow label="Onboarding" description="Walk through the welcome flow again.">
      <Button class="btn-secondary" onclick={rerunOnboarding}>Re-run onboarding</Button>
    </SettingsRow>
  </div>
</SettingsCard>

{#if themeExtensions.length > 0}
  <div class="section-header">Custom Themes</div>
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
          <div class="theme-item-name">Default</div>
          <div class="theme-item-meta">Built-in Asyar theme</div>
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
    padding: var(--space-5-5) var(--space-6);
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
