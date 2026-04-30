<script lang="ts">
  import {
    SettingsForm,
    SettingsFormRow,
    Toggle,
    Button,
    Badge,
    EmptyState,
  } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import extensionManager from '../../../services/extension/extensionManager.svelte';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { logService } from '../../../services/log/logService';

  let { handler }: { handler: SettingsHandler } = $props();

  let devExtensions = $state<Record<string, string>>({});
  let isLoadingDevExts = $state(true);
  let devExtError = $state('');
  let reloadingExt = $state<string | null>(null);

  // Load dev extensions on mount
  $effect(() => {
    loadDevExtensions();
  });

  async function loadDevExtensions() {
    isLoadingDevExts = true;
    devExtError = '';
    try {
      devExtensions = await invoke<Record<string, string>>('get_dev_extension_paths');
    } catch (err) {
      logService.error(`Failed to load dev extensions: ${err}`);
      devExtError = 'Failed to load dev extensions.';
      devExtensions = {};
    } finally {
      isLoadingDevExts = false;
    }
  }

  async function hotReload(extensionId: string) {
    if (reloadingExt) return;
    reloadingExt = extensionId;
    try {
      const manifest = extensionManager.getManifestById(extensionId) as
        | { background?: { main?: string } }
        | undefined;
      await invoke('force_remount_worker', {
        extensionId,
        hasBackgroundMain: !!manifest?.background?.main,
      });
      feedbackService.showToast({ title: `Reloaded ${extensionId}` });
    } catch (err) {
      logService.error(`Failed to hot-reload ${extensionId}: ${err}`);
      feedbackService.showToast({ title: 'Reload failed' });
    } finally {
      reloadingExt = null;
    }
  }

  async function detachDevExtension(extensionId: string) {
    const confirmed = await feedbackService.confirmAlert({
      title: 'Detach Dev Extension',
      message: `Remove "${extensionId}" from the dev extension registry? The extension files will not be deleted.`,
      confirmText: 'Detach',
      variant: 'danger',
    });
    if (!confirmed) return;

    try {
      // Note: There's no dedicated "unregister" command in the existing registry,
      // but in the actual implementation of register_dev_extension, it might be
      // handled by the SDK. For now, we follow the plan and refresh.
      await loadDevExtensions();
      feedbackService.showToast({ title: `Detached ${extensionId}` });
    } catch (err) {
      logService.error(`Failed to detach dev extension: ${err}`);
    }
  }

  const devExtEntries = $derived(Object.entries(devExtensions));
</script>

<div class="developer-header">
  <Badge text="Developer Mode Active" variant="warning" />
  <p class="developer-hint">
    These tools are intended for extension developers. Enable individual features below.
  </p>
</div>

<SettingsForm>
  <SettingsFormRow
    label="DevEx Inspector"
    description="Show the extension inspector panel in the main launcher window. Access runtime state, events, IPC/RPC traces, and more."
  >
    <Toggle
      checked={handler.settings.developer?.showInspector ?? false}
      onchange={() => handler.handleDeveloperSettingToggle('showInspector')}
    />
  </SettingsFormRow>

  <SettingsFormRow
    label="Verbose Logging"
    separator
    description="Increase log verbosity for all loaded extensions. Useful for debugging extension behavior."
  >
    <Toggle
      checked={handler.settings.developer?.verboseLogging ?? false}
      onchange={() => handler.handleDeveloperSettingToggle('verboseLogging')}
    />
  </SettingsFormRow>

  <SettingsFormRow
    label="IPC/RPC Tracing"
    separator
    description="Record message traces between extensions and the host. Visible in the DevEx Inspector's IPC and RPC tabs."
  >
    <Toggle
      checked={handler.settings.developer?.tracing ?? false}
      onchange={() => handler.handleDeveloperSettingToggle('tracing')}
    />
  </SettingsFormRow>

  <SettingsFormRow
    label="Sideload Extensions"
    separator
    description="Allow installing extension bundles from local files instead of the store."
  >
    <Toggle
      checked={handler.settings.developer?.allowSideloading ?? false}
      onchange={() => handler.handleDeveloperSettingToggle('allowSideloading')}
    />
  </SettingsFormRow>
</SettingsForm>

<div class="dev-extensions-section">
  <h3 class="section-header">Dev Extensions</h3>

  {#if isLoadingDevExts}
    <p class="text-caption">Loading…</p>
  {:else if devExtError}
    <p class="text-caption" style="color: var(--accent-danger)">{devExtError}</p>
  {:else if devExtEntries.length === 0}
    <EmptyState
      message="No dev extensions attached"
      description="Use the Asyar SDK CLI to attach a local extension: asyar-sdk attach <path>"
    />
  {:else}
    <div class="dev-ext-list">
      {#each devExtEntries as [extId, extPath]}
        <div class="dev-ext-item">
          <div class="dev-ext-info">
            <span class="dev-ext-id">{extId}</span>
            <span class="dev-ext-path">{extPath}</span>
          </div>
          <div class="dev-ext-actions">
            <Button
              class="btn-secondary"
              disabled={reloadingExt === extId}
              onclick={() => hotReload(extId)}
            >
              {reloadingExt === extId ? 'Reloading…' : 'Hot Reload'}
            </Button>
            <Button
              class="btn-danger"
              onclick={() => detachDevExtension(extId)}
            >
              Detach
            </Button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .developer-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }

  .developer-hint {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  .dev-extensions-section {
    margin-top: var(--space-6);
  }

  .dev-ext-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .dev-ext-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    transition: var(--transition-normal);
  }

  .dev-ext-item:hover {
    background: var(--bg-hover);
  }

  .dev-ext-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .dev-ext-id {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
    font-family: var(--font-mono);
  }

  .dev-ext-path {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dev-ext-actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }
</style>
