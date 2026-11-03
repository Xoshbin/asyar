<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ExtensionDetailPanel } from '../../../components';
  import SettingsDrillHeader from '../../../components/settings/SettingsDrillHeader.svelte';
  import { Toggle, Badge } from '../../../components';
  import ExtensionCommandRows from './ExtensionCommandRows.svelte';
  import { t } from '../../../services/i18n';
  import { extensionStateManager } from '../../../services/extension/extensionStateManager.svelte';
  import type { HostCommand } from '../../../types/ExtendedManifest';
  import type { SettingsHandler, ExtensionItem } from '../settingsHandlers.svelte';

  let {
    handler,
    extension,
    commandId = null,
    parentLabel,
    canBack,
    canForward,
    onback,
    onforward,
    oncommandselect,
    children,
  }: {
    handler: SettingsHandler;
    extension: ExtensionItem;
    commandId?: string | null;
    parentLabel: string;
    canBack: boolean;
    canForward: boolean;
    onback: () => void;
    onforward: () => void;
    /** A command row was picked; the parent drills into that command. */
    oncommandselect?: (cmd: HostCommand) => void;
    /** Feature-specific settings rendered under the detail panel. */
    children?: Snippet;
  } = $props();

  const command = $derived.by<{ cmd: HostCommand; parent: ExtensionItem } | null>(() => {
    const cmd = commandId ? extension.commands?.find((c) => c.id === commandId) : undefined;
    return cmd ? { cmd, parent: extension } : null;
  });

  // Applications renders its own discovered-apps table, so it has no command list.
  const showCommands = $derived(
    !command && extension.id !== 'built-in-applications' && (extension.commands?.length ?? 0) > 0,
  );
</script>

{#snippet actions()}
  {#if extension.isBuiltIn && !extension.disableable}
    <Badge text={t('settings.extensions.always_on')} variant="default" />
  {:else}
    <Toggle
      checked={extension.enabled === true}
      onchange={() => handler.toggleExtension(extension)}
    />
  {/if}
  {#if !extension.isBuiltIn}
    <button
      class="uninstall-btn"
      onclick={() => handler.requestUninstallExtension(extension)}
      disabled={extensionStateManager.extensionUninstallInProgress !== null}
    >
      {extensionStateManager.extensionUninstallInProgress !== null
        ? t('settings.extensions.uninstalling')
        : t('settings.extensions.uninstall')}
    </button>
  {/if}
{/snippet}

<div class="drill-view">
  <SettingsDrillHeader
    title={extension.title}
    {parentLabel}
    {canBack}
    {canForward}
    {onback}
    {onforward}
    actions={command ? undefined : actions}
  />

  <ExtensionDetailPanel
    extension={command ? null : extension}
    {command}
    preferencesVersion={handler.preferencesVersion}
  />

  {@render children?.()}

  {#if showCommands}
    <section class="commands-card" style="--ext-cols: 1fr 112px 112px 32px;">
      <div class="commands-title">{t('settings.extensions.section_commands')}</div>
      <div class="col-headers">
        <span>{t('settings.extensions.table_name')}</span>
        <span>{t('settings.extensions.table_alias')}</span>
        <span>{t('settings.extensions.table_hotkey')}</span>
        <span class="col-on"></span>
      </div>
      <div class="commands-body">
        <ExtensionCommandRows {extension} showType={false} onselect={oncommandselect} />
      </div>
    </section>
  {/if}
</div>

<style>
  .drill-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* Net gap to the card below: 16px gap - 10px = 6px. */
  .drill-view > :global(.section-header) {
    margin-bottom: calc(-1 * var(--space-4));
  }

  /* Same frame as SettingsCard so its edges line up with the cards around it. */
  .commands-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .commands-title {
    padding: var(--space-5) var(--space-6) var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .col-headers {
    display: grid;
    grid-template-columns: var(--ext-cols);
    padding: var(--space-3) var(--space-6);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--separator);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .col-on {
    text-align: center;
  }

  .uninstall-btn {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    background: none;
    border: none;
    cursor: default;
    padding: 0;
    transition: var(--transition-fast);
  }

  .uninstall-btn:hover {
    opacity: 0.8;
  }

  .uninstall-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .commands-body > :global(:last-child) {
    border-bottom: none;
  }
</style>
