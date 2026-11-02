<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ExtensionDetailPanel } from '../../../components';
  import SettingsDrillHeader from '../../../components/settings/SettingsDrillHeader.svelte';
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

<div class="drill-view">
  <SettingsDrillHeader
    title={extension.title}
    {parentLabel}
    {canBack}
    {canForward}
    {onback}
    {onforward}
  />

  <ExtensionDetailPanel
    extension={command ? null : extension}
    {command}
    isToggling={handler.togglingExtension !== null}
    isUninstalling={extensionStateManager.extensionUninstallInProgress !== null}
    preferencesVersion={handler.preferencesVersion}
    onToggle={(ext) => handler.toggleExtension(ext)}
    onUninstall={(ext) => handler.requestUninstallExtension(ext)}
  />

  {#if showCommands}
    <section class="commands-card" style="--ext-cols: 1fr 112px 112px 56px;">
      <div class="commands-title">{t('settings.extensions.section_commands')}</div>
      <div class="col-headers">
        <span>{t('settings.extensions.table_name')}</span>
        <span>{t('settings.extensions.table_alias')}</span>
        <span>{t('settings.extensions.table_hotkey')}</span>
        <span class="col-on">{t('settings.extensions.table_enabled')}</span>
      </div>
      <div class="commands-body">
        <ExtensionCommandRows {extension} showType={false} onselect={oncommandselect} />
      </div>
    </section>
  {/if}

  {@render children?.()}
</div>

<style>
  .drill-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* Same frame as SettingsCard so its edges line up with the cards around it. */
  .commands-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
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
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
    border-bottom: 1px solid var(--separator);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .col-on {
    text-align: center;
  }

  .commands-body > :global(:last-child) {
    border-bottom: none;
  }
</style>
