<script lang="ts">
  import {
    SettingsCard,
    SettingsRow,
    Toggle,
    Button,
    Badge,
    EmptyState,
  } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import extensionManager from '../../../services/extension/extensionManager.svelte';
  import { getDevExtensionPaths } from '../../../lib/ipc/commands';
  import { forceRemountWorker } from '../../../lib/ipc/devCommands';
  import { t } from '../../../services/i18n';

  let { handler }: { handler: SettingsHandler } = $props();

  let devExtensions = $state<Record<string, string>>({});
  let isLoadingDevExts = $state(true);
  let devExtError = $state('');
  let reloadingExt = $state<string | null>(null);
  let detachingExt = $state<string | null>(null);

  // Load dev extensions on mount
  $effect(() => {
    loadDevExtensions();
  });

  async function loadDevExtensions() {
    isLoadingDevExts = true;
    devExtError = '';
    const result = await getDevExtensionPaths();
    if (result === null) {
      logService.error('Failed to load dev extensions');
      devExtError = 'Failed to load dev extensions.';
      devExtensions = {};
    } else {
      devExtensions = result;
    }
    isLoadingDevExts = false;
  }

  async function hotReload(extensionId: string) {
    if (reloadingExt) return;
    reloadingExt = extensionId;
    const manifest = extensionManager.getManifestById(extensionId) as
      { background?: { main?: string } } | undefined;
    const ok = await forceRemountWorker(extensionId, !!manifest?.background?.main);
    if (ok) {
      void feedbackService.report({
        kind: 'manual',
        severity: 'success',
        retryable: false,
        context: { message: `Reloaded ${extensionId}` },
      });
    } else {
      logService.error(`Failed to hot-reload ${extensionId}`);
      void feedbackService.report({
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: 'Reload failed' },
      });
    }
    reloadingExt = null;
  }

  async function detachDevExtension(extensionId: string) {
    if (detachingExt) return;
    const confirmed = await feedbackService.confirmAlert({
      title: 'Detach Dev Extension',
      message: `Remove "${extensionId}" from the dev extension registry? The extension files will not be deleted.`,
      confirmText: 'Detach',
      variant: 'danger',
    });
    if (!confirmed) return;

    detachingExt = extensionId;
    try {
      // Note: There's no dedicated "unregister" command in the existing registry,
      // but in the actual implementation of register_dev_extension, it might be
      // handled by the SDK. For now, we follow the plan and refresh.
      await loadDevExtensions();
      void feedbackService.report({
        kind: 'manual',
        severity: 'success',
        retryable: false,
        context: { message: `Detached ${extensionId}` },
      });
    } catch (err) {
      logService.error(`Failed to detach dev extension: ${err}`);
    } finally {
      detachingExt = null;
    }
  }

  const devExtEntries = $derived(Object.entries(devExtensions));
</script>

<div class="developer-tab">
  <div id="developer-tools" class="anchor-group">
    <div class="section-header">{t('settings.developer.section_tools')}</div>
    <SettingsCard>
      <SettingsRow
        label={t('settings.developer.developer_mode')}
        description={t('settings.developer.developer_mode_description')}
      >
        {#snippet children()}
          <Badge text={t('settings.developer.active')} variant="warning" />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label={t('settings.developer.devex_inspector')}
        description={t('settings.developer.devex_inspector_description')}
      >
        {#snippet children()}
          <Toggle
            checked={handler.settings.developer?.showInspector ?? false}
            onchange={() => handler.handleDeveloperSettingToggle('showInspector')}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label={t('settings.developer.verbose_logging')}
        description={t('settings.developer.verbose_logging_description')}
      >
        {#snippet children()}
          <Toggle
            checked={handler.settings.developer?.verboseLogging ?? false}
            onchange={() => handler.handleDeveloperSettingToggle('verboseLogging')}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label={t('settings.developer.tracing')}
        description={t('settings.developer.tracing_description')}
      >
        {#snippet children()}
          <Toggle
            checked={handler.settings.developer?.tracing ?? false}
            onchange={() => handler.handleDeveloperSettingToggle('tracing')}
          />
        {/snippet}
      </SettingsRow>

      <SettingsRow
        label={t('settings.developer.sideload')}
        description={t('settings.developer.sideload_description')}
      >
        {#snippet children()}
          <Toggle
            checked={handler.settings.developer?.allowSideloading ?? false}
            onchange={() => handler.handleDeveloperSettingToggle('allowSideloading')}
          />
        {/snippet}
      </SettingsRow>
    </SettingsCard>
  </div>

  <div id="developer-extensions" class="anchor-group">
    <div class="section-header">{t('settings.developer.section_dev_extensions')}</div>
    <SettingsCard>
      {#if isLoadingDevExts}
        <div class="dev-ext-state text-caption">{t('common.loading')}</div>
      {:else if devExtError}
        <div class="dev-ext-state error-text text-caption">{devExtError}</div>
      {:else if devExtEntries.length === 0}
        <div class="dev-ext-empty">
          <EmptyState
            compact
            message={t('settings.developer.no_dev_extensions')}
            description={t('settings.developer.no_dev_extensions_description')}
          />
        </div>
      {:else}
        {#each devExtEntries as [extId, extPath]}
          <SettingsRow label={extId} description={extPath}>
            {#snippet children()}
              <div class="dev-ext-actions">
                <Button disabled={reloadingExt === extId} onclick={() => hotReload(extId)}>
                  {reloadingExt === extId
                    ? t('settings.developer.reloading')
                    : t('settings.developer.hot_reload')}
                </Button>
                <Button
                  class="btn-danger"
                  disabled={detachingExt === extId}
                  onclick={() => detachDevExtension(extId)}
                >
                  {detachingExt === extId
                    ? t('settings.developer.detaching')
                    : t('settings.developer.detach')}
                </Button>
              </div>
            {/snippet}
          </SettingsRow>
        {/each}
      {/if}
    </SettingsCard>
  </div>
</div>

<style>
  .developer-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .anchor-group {
    scroll-margin-top: var(--space-6);
  }

  .dev-ext-state,
  .dev-ext-empty {
    padding: var(--space-3) var(--space-4);
  }

  .dev-ext-actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .error-text {
    color: var(--accent-danger);
  }
</style>
