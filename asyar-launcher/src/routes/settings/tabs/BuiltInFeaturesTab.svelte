<script lang="ts">
  import type { Component } from 'svelte';
  import type { SettingsHandler, ExtensionItem } from '../settingsHandlers.svelte';
  import { t } from '../../../services/i18n';
  import AiTab from './AiTab.svelte';
  import FileSearchTab from './FileSearchTab.svelte';
  import BrowsersTab from './BrowsersTab.svelte';
  import ScriptsTab from './ScriptsTab.svelte';
  import ClipboardPrivacySection from '../../../components/settings/ClipboardPrivacySection.svelte';
  import SnippetsTextExpansionCard from '../../../components/settings/SnippetsTextExpansionCard.svelte';
  import ExtensionTable from './ExtensionTable.svelte';
  import ExtensionDrillView from './ExtensionDrillView.svelte';
  import SettingsDrillHeader from '../../../components/settings/SettingsDrillHeader.svelte';
  import { DrillState } from './drillState.svelte';

  let { handler }: { handler: SettingsHandler } = $props();

  // Feature-specific settings rendered under the detail panel (spec §3.1).
  // Features absent from this map render the detail panel alone.
  const PANELS: Record<string, Component<any>> = {
    'built-in-ai': AiTab,
    'built-in-file-search': FileSearchTab,
    'built-in-browsers': BrowsersTab,
    'built-in-scripts': ScriptsTab,
    'built-in-clipboard-history': ClipboardPrivacySection,
    'built-in-snippets': SnippetsTextExpansionCard,
  };
  // Panels that take the settings handler as a prop.
  const HANDLER_PANELS = new Set(['built-in-ai']);

  const drill = new DrillState();
  const idOf = (e: ExtensionItem) => e.id ?? e.title;

  const selected = $derived(
    handler.extensions.find((e) => e.isBuiltIn && idOf(e) === drill.id) ?? null,
  );
  const Panel = $derived(drill.id ? PANELS[drill.id] : undefined);

  // Deep link (asyar:navigate-settings-tab): wait for the list, then consume
  // the pending id exactly once. An unknown id just leaves the list showing.
  $effect(() => {
    const pending = handler.pendingExtensionSelection;
    if (!pending || handler.isLoadingExtensions) return;
    if (handler.extensions.length === 0) return;
    const ext = handler.extensions.find((e) => e.isBuiltIn && idOf(e) === pending);
    if (ext) drill.into(idOf(ext));
    handler.pendingExtensionSelection = null;
  });

  // The drilled feature disappeared (e.g. list reloaded): fall back to the list.
  $effect(() => {
    if (drill.id && !handler.isLoadingExtensions && !selected) drill.reset();
  });
</script>

{#if drill.id && selected}
  <ExtensionDrillView
    {handler}
    extension={selected}
    commandId={drill.commandId}
    parentLabel={t('settings.tabs.built_in_features')}
    canBack={drill.canBack}
    canForward={drill.canForward}
    onback={() => drill.back()}
    onforward={() => drill.forward()}
    oncommandselect={(cmd) => drill.into(idOf(selected), cmd.id)}
  >
    {#if Panel}
      {#if HANDLER_PANELS.has(drill.id)}
        <Panel {handler} />
      {:else}
        <Panel />
      {/if}
    {/if}
  </ExtensionDrillView>
{:else}
  {#if drill.canForward}
    <SettingsDrillHeader
      parentLabel={t('settings.tabs.built_in_features')}
      canBack={false}
      canForward
      onback={() => drill.back()}
      onforward={() => drill.forward()}
    />
  {/if}
  <ExtensionTable
    {handler}
    scope="built-in"
    onselect={(ext, cmd) => drill.into(idOf(ext), cmd?.id ?? null)}
  />
{/if}
