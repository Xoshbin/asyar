<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ExtensionDetailPanel } from '../../../components';
  import SettingsDrillHeader from '../../../components/settings/SettingsDrillHeader.svelte';
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
    /** Feature-specific settings rendered under the detail panel. */
    children?: Snippet;
  } = $props();

  const command = $derived.by<{ cmd: HostCommand; parent: ExtensionItem } | null>(() => {
    const cmd = commandId ? extension.commands?.find((c) => c.id === commandId) : undefined;
    return cmd ? { cmd, parent: extension } : null;
  });
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

  {@render children?.()}
</div>

<style>
  .drill-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
</style>
