<script lang="ts">
  import { EmptyState } from '../index';
  import Badge from '../base/Badge.svelte';
  import Toggle from '../base/Toggle.svelte';
  import ExtensionPreferencesForm from './ExtensionPreferencesForm.svelte';
  import PermissionList from './PermissionList.svelte';
  import type { ExtensionItem } from '../../routes/settings/settingsHandlers.svelte';
  import type { ExtensionCommand } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';
  import { extensionPreferencesService } from '../../services/extension/extensionPreferencesService.svelte';
  import { permissionConsentService } from '../../services/extension/permissionConsentService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { logService } from '../../services/log/logService';
  import * as commands from '../../lib/ipc/commands';
  import { getRuntimeDownloadSizes, type RuntimeDownload } from '../../lib/ipc/runtimeCommands';
  import { downloadDeclaredRuntimes } from '../../services/extension/runtimeDownloads';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { runtimeService } from '../../services/runtime/runtimeService.svelte';
  import {
    formatRuntimeDownloadStatus,
    describeMissingRuntimesForConfirm,
  } from '../../services/runtime/runtimeDownloadStatus';
  import Icon from '../base/Icon.svelte';
  import { isBuiltInIcon, isIconImage, getBuiltInIconName } from '../../lib/iconUtils';
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
  let needsPermissionReview = $state(false);
  let isDownloadingRuntime = $state(false);
  let needsRuntimeDownload = $state(false);
  let missingRuntimes = $state<RuntimeDownload[]>([]);

  const runtimeDownloadLabel = $derived(
    isDownloadingRuntime
      ? formatRuntimeDownloadStatus(runtimeService.downloadProgress, t('common.downloading'))
      : t('settings.extensions.download_runtime'),
  );

  // Settings is a separate webview from the main window (see the consent
  // effect below), so it can't see the main window's in-memory
  // `extensionStateManager.needsRuntime` — that state simply doesn't exist
  // here. Re-derive whether a declared runtime is still missing via the
  // same IPC calls the consent dialog uses, same pattern as
  // `needsPermissionReview` below.
  async function refreshRuntimeStatus(extensionId: string): Promise<void> {
    const status = await commands.checkExtensionConsent(extensionId);
    const declared = status?.declaredRuntimes ?? [];
    if (declared.length === 0) {
      if (extension?.id === extensionId) {
        needsRuntimeDownload = false;
        missingRuntimes = [];
      }
      return;
    }
    const missing = await getRuntimeDownloadSizes(declared);
    if (extension?.id === extensionId) {
      needsRuntimeDownload = missing.length > 0;
      missingRuntimes = missing;
    }
  }

  $effect(() => {
    const ext = extension;
    needsRuntimeDownload = false;
    missingRuntimes = [];
    if (ext?.id && !ext.isBuiltIn) {
      refreshRuntimeStatus(ext.id);
    }
  });

  async function retryRuntimeDownload() {
    const ext = extension;
    if (!ext?.id) return;
    // No silent downloads — confirm before pulling potentially hundreds of
    // MB, same principle the Store install flow already follows. The badge
    // already told the user *that* something's missing; this confirms
    // *what* and *how big* before actually starting.
    if (missingRuntimes.length > 0) {
      const { title, message } = describeMissingRuntimesForConfirm(missingRuntimes);
      const confirmed = await feedbackService.confirmAlert({
        title,
        message,
        confirmText: t('settings.extensions.download'),
      });
      if (!confirmed) return;
    }
    isDownloadingRuntime = true;
    try {
      await downloadDeclaredRuntimes(ext.id);
      await extensionManager.reloadExtensions();
      await refreshRuntimeStatus(ext.id);
    } finally {
      isDownloadingRuntime = false;
    }
  }

  // Consent status is re-derived per selection via IPC: the settings window
  // is a separate webview, so it cannot see the main window's in-memory
  // needs-review state — but the Rust registry it queries is global.
  // consentVersion re-runs this after an acceptance recorded outside this
  // panel (e.g. the enable-toggle flow), so the badge clears immediately.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    permissionConsentService.consentVersion; // touch to subscribe
    const ext = extension;
    needsPermissionReview = false;
    if (ext?.id && !ext.isBuiltIn && (ext.permissions?.length ?? 0) > 0) {
      commands.checkExtensionConsent(ext.id).then((status) => {
        if (extension?.id === ext.id) {
          needsPermissionReview = status?.needsConsent ?? false;
        }
      });
    }
  });

  async function reviewPermissions() {
    const ext = extension;
    if (!ext?.id) return;
    const accepted = await permissionConsentService.ensureConsent(ext.id, ext.title, 'review');
    if (accepted && extension?.id === ext.id) {
      needsPermissionReview = false;
    }
  }

  // Revoking withdraws consent without uninstalling — the extension stays
  // installed and enabled, but its gated calls fail closed until the user
  // reviews and re-allows via reviewPermissions() above.
  async function revokePermissions() {
    const ext = extension;
    if (!ext?.id) return;
    const confirmed = await feedbackService.confirmAlert({
      title: t('settings.extensions.revoke_permissions_title'),
      message: `"${ext.title}" will lose access to its granted permissions until you review and re-allow them. It stays installed and enabled.`,
      confirmText: t('settings.extensions.revoke'),
      variant: 'danger',
    });
    if (!confirmed) return;
    const revoked = await permissionConsentService.revoke(ext.id);
    if (revoked && extension?.id === ext.id) {
      needsPermissionReview = true;
    }
  }

  // Load preferences when selection changes OR when preferencesVersion bumps.
  // Reading `preferencesVersion` inside the effect makes it a reactive
  // dependency — Svelte re-runs the effect each time it changes.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    preferencesVersion; // touch to subscribe
    const id = command?.parent.id ?? extension?.id;
    if (id) {
      isLoadingPrefs = true;
      extensionPreferencesService
        .getEffectivePreferences(id)
        .then((bundle) => {
          if (command) {
            preferenceValues = bundle.commands[command.cmd.id] ?? {};
          } else {
            preferenceValues = bundle.extension ?? {};
          }
        })
        .finally(() => {
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
      await extensionPreferencesService.set(id, command?.cmd.id ?? null, name, value);
    } catch (err) {
      logService.error(`Failed to save preference ${name} for ${id}: ${err}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not save preference "${name}"` },
      });
    }
  }
</script>

{#if command}
  <div class="panel-header">
    <div class="panel-icon">
      {#if command.cmd.icon && isBuiltInIcon(command.cmd.icon)}
        <Icon name={getBuiltInIconName(command.cmd.icon)} size={28} />
      {:else if command.cmd.icon && isIconImage(command.cmd.icon)}
        <img src={command.cmd.icon} alt={command.cmd.name} class="panel-icon-img" />
      {:else if command.cmd.icon}
        <span class="panel-icon-emoji">{command.cmd.icon}</span>
      {:else if command.parent.iconUrl && isBuiltInIcon(command.parent.iconUrl)}
        <Icon name={getBuiltInIconName(command.parent.iconUrl)} size={28} />
      {:else if command.parent.iconUrl && isIconImage(command.parent.iconUrl)}
        <img src={command.parent.iconUrl} alt={command.parent.title} class="panel-icon-img" />
      {:else if command.parent.iconUrl}
        <span class="panel-icon-emoji">{command.parent.iconUrl}</span>
      {:else}
        <span class="panel-icon-letter">{command.parent.title[0]?.toUpperCase() ?? 'E'}</span>
      {/if}
    </div>
    <div class="panel-meta">
      <div class="panel-title">{command.cmd.name}</div>
      <div class="panel-parent">{command.parent.title}</div>
    </div>
  </div>
{:else if extension}
  <div class="panel-header">
    <div class="panel-icon">
      {#if extension.iconUrl && isBuiltInIcon(extension.iconUrl)}
        <Icon name={getBuiltInIconName(extension.iconUrl)} size={28} />
      {:else if extension.iconUrl && isIconImage(extension.iconUrl)}
        <img src={extension.iconUrl} alt={extension.title} class="panel-icon-img" />
      {:else if extension.iconUrl}
        <span class="panel-icon-emoji">{extension.iconUrl}</span>
      {:else}
        <span class="panel-icon-letter">{extension.title[0]?.toUpperCase() ?? 'E'}</span>
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
          {isUninstalling
            ? t('settings.extensions.uninstalling')
            : t('settings.extensions.uninstall')}
        </button>
      {/if}
    </div>
  </div>

  <div class="panel-body">
    {#if extension.subtitle}
      <div class="panel-section">
        <div class="section-header">{t('common.description')}</div>
        <p class="panel-desc">{extension.subtitle}</p>
      </div>
    {/if}

    {#if needsRuntimeDownload}
      <div class="panel-section">
        <div class="section-header flex-header">
          <span>Runtime</span>
          <button
            class="review-link"
            onclick={retryRuntimeDownload}
            disabled={isDownloadingRuntime}
          >
            {runtimeDownloadLabel}
          </button>
        </div>
        <p class="panel-desc">
          A required runtime failed to download or was declined. Commands are hidden until it's
          installed — retry from here.
        </p>
      </div>
    {/if}

    <div class="panel-section panel-badges">
      {#if extension.isBuiltIn}
        <Badge text="BUILT-IN" variant="info" />
      {:else if extension.type}
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
      {#if needsPermissionReview}
        <Badge text={t('settings.extensions.permissions_need_review')} variant="danger" />
      {/if}
      {#if needsRuntimeDownload}
        <Badge text={t('settings.extensions.needs_runtime_download')} variant="danger" />
      {/if}
    </div>

    {#if !extension.isBuiltIn && extension.permissions && extension.permissions.length > 0}
      <div class="panel-section">
        <div class="section-header flex-header">
          <span>{t('settings.extensions.permissions')}</span>
          {#if needsPermissionReview}
            <button class="review-link" onclick={reviewPermissions}
              >{t('settings.extensions.review_permissions')}</button
            >
          {:else}
            <button class="revoke-link" onclick={revokePermissions}
              >{t('settings.extensions.revoke')}</button
            >
          {/if}
        </div>
        <PermissionList
          permissions={extension.permissions}
          permissionArgs={extension.permissionArgs ?? {}}
        />
      </div>
    {/if}

    {#if extension.preferences && extension.preferences.length > 0}
      <div class="panel-section">
        <div class="section-header flex-header">
          <span>Preferences</span>
          <button
            class="reset-link"
            onclick={() => extensionPreferencesService.reset(extension!.id!)}
          >
            {t('settings.extensions.reset_to_defaults')}
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
  <EmptyState message={t('settings.extensions.select_extension_or_command')} />
{/if}

<style>
  .panel-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
    padding: var(--space-8) var(--space-7) var(--space-6);
    border-bottom: 1px solid var(--border-color);
  }

  .panel-icon {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-xl);
    background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-2xl);
    font-weight: 700;
    color: var(--accent-primary);
    flex-shrink: 0;
    overflow: hidden;
  }

  .panel-icon-img {
    width: 28px;
    height: 28px;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  .panel-icon-emoji {
    font-size: 24px; /* design-ok: emoji precise optical size beyond type scale */
    line-height: 1;
  }

  .panel-icon-letter {
    font-size: var(--font-size-xl);
    font-weight: 700;
    color: var(--accent-primary);
  }

  .icon-img {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
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
    padding: var(--space-6) var(--space-7);
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
    font-size: var(--font-size-2xs);
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

  .review-link {
    font-size: var(--font-size-2xs);
    color: var(--accent-danger);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: var(--transition-fast);
  }

  .review-link:hover {
    text-decoration: underline;
  }

  .review-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .revoke-link {
    font-size: var(--font-size-2xs);
    color: var(--accent-danger);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: var(--transition-fast);
  }

  .revoke-link:hover {
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
</style>
