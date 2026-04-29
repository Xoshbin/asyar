<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsForm,
    SettingsFormRow,
    Checkbox,
    ShortcutRecorder,
    AppearanceThemeSelector,
    WindowModeSelector,
    Button,
  } from '../../../components';
  import { onboardingCommands } from '../../../lib/ipc/commands';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { normalizeShortcut } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import { applyTheme, removeTheme } from '../../../services/theme/themeService';
  import { discoverExtensions } from '../../../lib/ipc/commands';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { emit } from '@tauri-apps/api/event';
  import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';
  import { logService } from '../../../services/log/logService';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let themeExtensions = $state<Array<{ id: string; name: string; author?: string; version: string }>>([]);
  let activeThemeId = $state<string | null>(null);

  onMount(async () => {
    try {
      const records = await discoverExtensions();
      themeExtensions = records
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
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'warning',
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

  async function selectLaunchView(launchView: 'default' | 'compact') {
    await handler.updateLaunchView(launchView);
    await emit('asyar:launch-view-changed', { launchView });
  }

  async function rerunOnboarding() {
    try {
      await onboardingCommands.reset();
    } catch (e) {
      logService.error(`Failed to re-run onboarding: ${e}`);
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'error',
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
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'error',
        retryable: false,
        context: { message: themeId ? `Could not apply theme "${themeId}"` : 'Could not remove active theme' },
      });
    }
  }
</script>

<SettingsForm>
  <SettingsFormRow label="Startup">
    <div class="checkbox-row">
      <Checkbox
        checked={handler.settings.general.startAtLogin}
        onchange={() => handler.handleAutostartToggle()}
      />
      <span class="checkbox-label">Launch Asyar at login</span>
    </div>
  </SettingsFormRow>

  <SettingsFormRow label="Hotkey">
    <ShortcutRecorder
      bind:modifier={handler.selectedModifier}
      bind:key={handler.selectedKey}
      placeholder="Click to set shortcut"
      disabled={handler.isSaving}
      onsave={handleSave}
      {conflictChecker}
    />
  </SettingsFormRow>

  <SettingsFormRow label="Appearance" separator>
    <AppearanceThemeSelector
      value={handler.selectedTheme as 'light' | 'dark' | 'system'}
      onchange={(v) => handler.updateThemeSetting(v)}
    />
  </SettingsFormRow>

  <SettingsFormRow label="Window Mode">
    <WindowModeSelector
      value={handler.selectedLaunchView}
      onchange={selectLaunchView}
    />
  </SettingsFormRow>

  <SettingsFormRow label="Onboarding" separator>
    <div class="onboarding-row">
      <span class="onboarding-row__hint">Walk through the welcome flow again.</span>
      <Button class="btn-secondary" onclick={rerunOnboarding}>Re-run onboarding</Button>
    </div>
  </SettingsFormRow>
</SettingsForm>

{#if themeExtensions.length > 0}
<div class="themes-section">
  <div class="themes-section-header">Custom Themes</div>
  <div class="themes-list">
    <label class="theme-item" class:theme-active={activeThemeId === null}>
      <input type="radio" name="custom-theme" checked={activeThemeId === null} onchange={() => selectTheme(null)} class="sr-only">
      <div class="theme-item-body">
        <div class="theme-item-name">Default</div>
        <div class="theme-item-meta">Built-in Asyar theme</div>
      </div>
    </label>

    {#each themeExtensions as theme}
      <label class="theme-item" class:theme-active={activeThemeId === theme.id}>
        <input type="radio" name="custom-theme" checked={activeThemeId === theme.id} onchange={() => selectTheme(theme.id)} class="sr-only">
        <div class="theme-item-body">
          <div class="theme-item-name">{theme.name}</div>
          <div class="theme-item-meta">
            {#if theme.author}{theme.author} &middot; {/if}v{theme.version}
          </div>
        </div>
      </label>
    {/each}
  </div>
</div>
{/if}

<style>
  .onboarding-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }

  .onboarding-row__hint {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }

  .themes-section {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--separator);
    margin-top: var(--space-4);
  }

  .themes-section-header {
    padding: var(--space-4) var(--space-6) var(--space-2) calc(var(--space-6) + 9rem + var(--space-6));
    font-size: var(--font-size-xs);
    font-weight: 600;
    font-family: var(--font-ui);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .themes-list {
    display: flex;
    flex-direction: column;
  }

  .theme-item {
    display: flex;
    align-items: center;
    padding: var(--space-3) var(--space-6) var(--space-3) calc(var(--space-6) + 9rem + var(--space-6));
    border-bottom: 1px solid var(--separator);
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .theme-item:last-child {
    border-bottom: none;
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
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
  }

  .theme-item-meta {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    margin-top: var(--space-1);
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .checkbox-label {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
  }
</style>
