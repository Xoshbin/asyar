<script lang="ts">
  import Badge from '../base/Badge.svelte';
  import Toggle from '../base/Toggle.svelte';
  import ExtensionPreferencesForm from './ExtensionPreferencesForm.svelte';
  import type { ExtensionItem } from '../../routes/settings/settingsHandlers.svelte';
  import type { ExtensionCommand } from 'asyar-sdk';
  import { extensionPreferencesService } from '../../services/extension/extensionPreferencesService.svelte';

  let {
    extension = null,
    command = null,
    isToggling = false,
    isUninstalling = false,
    preferencesVersion = 0,
    onToggle,
    onUninstall,
  }: {
    extension?: ExtensionItem | null;
    command?: { cmd: ExtensionCommand; parent: ExtensionItem } | null;
    isToggling?: boolean;
    isUninstalling?: boolean;
    /**
     * Reactive bump counter from SettingsHandler. Incremented whenever an
     * `asyar:preferences-changed` Tauri event arrives, so the load effect
     * below re-runs and picks up fresh values after a cross-webview write.
     */
    preferencesVersion?: number;
    onToggle?: (ext: ExtensionItem) => void;
    onUninstall?: (ext: ExtensionItem) => void;
  } = $props();

  let preferenceValues = $state<Record<string, any>>({});
  let isLoadingPrefs = $state(false);

  // Load preferences when selection changes OR when preferencesVersion bumps.
  // Reading `preferencesVersion` inside the effect makes it a reactive
  // dependency — Svelte re-runs the effect each time it changes.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    preferencesVersion; // touch to subscribe
    const id = command?.parent.id ?? extension?.id;
    if (id) {
      isLoadingPrefs = true;
      extensionPreferencesService.getEffectivePreferences(id).then(bundle => {
        if (command) {
          preferenceValues = bundle.commands[command.cmd.id] ?? {};
        } else {
          preferenceValues = bundle.extension ?? {};
        }
      }).finally(() => {
        isLoadingPrefs = false;
      });
    } else {
      preferenceValues = {};
    }
  });

  async function handlePreferenceChange(name: string, value: any) {
    const id = command?.parent.id ?? extension?.id;
    if (!id) return;

    // Optimistic local update — Rust will emit asyar:preferences-changed
    // which bumps preferencesVersion and re-runs the load effect above,
    // reconciling with whatever Rust actually stored.
    preferenceValues = { ...preferenceValues, [name]: value };

    try {
      await extensionPreferencesService.set(
        id,
        command?.cmd.id ?? null,
        name,
        value
      );
    } catch (err) {
      console.error('Failed to save preference:', err);
    }
  }
</script>

{#if command}
  <div class="panel-header">
    <div class="panel-icon">
      {command.parent.title[0]?.toUpperCase() ?? 'E'}
    </div>
    <div class="panel-meta">
      <div class="panel-title">{command.cmd.name}</div>
      <div class="panel-parent">{command.parent.title}</div>
    </div>
  </div>

  <div class="panel-body">
    {#if command.cmd.description}
      <div class="panel-section">
        <div class="section-header">Description</div>
        <p class="panel-desc">{command.cmd.description}</p>
      </div>
    {/if}

    <div class="panel-section">
      <div class="section-header">Trigger</div>
      <code class="trigger-chip text-mono">{command.cmd.trigger}</code>
    </div>

    <div class="panel-section">
      <div class="section-header">Alias</div>
      <span class="placeholder-action">Add alias…</span>
    </div>

    <div class="panel-section">
      <div class="section-header">Hotkey</div>
      <span class="placeholder-action">Record hotkey…</span>
    </div>

    {#if command.cmd.preferences && command.cmd.preferences.length > 0}
      <div class="panel-section">
        <div class="section-header">Preferences</div>
        <ExtensionPreferencesForm
          preferences={command.cmd.preferences}
          values={preferenceValues}
          disabled={isLoadingPrefs}
          onChange={handlePreferenceChange}
        />
      </div>
    {/if}
  </div>

{:else if extension}
  <div class="panel-header">
    <div class="panel-icon">
      {#if extension.iconUrl}
        <img src={extension.iconUrl} alt={extension.title} class="icon-img" />
      {:else}
        {extension.title[0]?.toUpperCase() ?? 'E'}
      {/if}
    </div>
    <div class="panel-meta">
      <div class="panel-title">{extension.title}</div>
    </div>
    <div class="panel-actions">
      <Toggle
        checked={extension.enabled === true}
        disabled={isToggling}
        onchange={() => onToggle?.(extension!)}
      />
      {#if !extension.isBuiltIn}
        <button
          class="uninstall-btn"
          onclick={() => onUninstall?.(extension!)}
          disabled={isUninstalling}
        >
          {isUninstalling ? 'Uninstalling…' : 'Uninstall'}
        </button>
      {/if}
    </div>
  </div>

  <div class="panel-body">
    {#if extension.subtitle}
      <div class="panel-section">
        <div class="section-header">Description</div>
        <p class="panel-desc">{extension.subtitle}</p>
      </div>
    {/if}

    <div class="panel-section panel-badges">
      {#if extension.type}
        <Badge text={extension.type.toUpperCase()} variant="info" />
      {/if}
      {#if extension.version}
        <Badge text="v{extension.version}" variant="default" mono />
      {/if}
      {#if extension.compatibility?.status === 'sdkMismatch'}
        <Badge text="Requires SDK {extension.compatibility.required}" variant="danger" />
      {/if}
      {#if extension.compatibility?.status === 'appVersionTooOld'}
        <Badge text="Requires app v{extension.compatibility.required}+" variant="danger" />
      {/if}
      {#if extension.compatibility?.status === 'platformNotSupported'}
        <Badge text="{extension.compatibility.platform} not supported" variant="danger" />
      {/if}
    </div>

    {#if extension.preferences && extension.preferences.length > 0}
      <div class="panel-section">
        <div class="section-header flex-header">
          <span>Preferences</span>
          <button 
            class="reset-link" 
            onclick={() => extensionPreferencesService.reset(extension!.id!)}
          >
            Reset to Defaults
          </button>
        </div>
        <ExtensionPreferencesForm
          preferences={extension.preferences}
          values={preferenceValues}
          disabled={isLoadingPrefs}
          onChange={handlePreferenceChange}
        />
      </div>
    {/if}
  </div>

{:else}
  <div class="empty-panel">
    <p class="empty-panel-text">Select an extension or command</p>
  </div>
{/if}

<style>
  .panel-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--separator);
  }

  .panel-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .icon-img {
    width: 22px;
    height: 22px;
  }

  .panel-meta {
    flex: 1;
    min-width: 0;
  }

  .panel-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .panel-parent {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-top: var(--space-1);
  }

  .panel-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    margin-top: var(--space-1);
  }

  .uninstall-btn {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: var(--transition-fast);
  }

  .uninstall-btn:hover {
    opacity: 0.8;
  }

  .uninstall-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .panel-body {
    padding: var(--space-3) var(--space-4);
  }

  .panel-section {
    margin-bottom: var(--space-4);
  }

  .panel-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .flex-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .reset-link {
    font-size: 10px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: var(--transition-fast);
  }

  .reset-link:hover {
    color: var(--accent-danger);
    text-decoration: underline;
  }

  .panel-desc {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .trigger-chip {
    display: inline-block;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .placeholder-action {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-style: italic;
  }

  .empty-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--space-8);
  }

  .empty-panel-text {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
</style>
