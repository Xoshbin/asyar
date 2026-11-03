<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle } from '../../../components';
  import type { SettingsHandler, ExtensionItem } from '../settingsHandlers.svelte';
  import { t } from '../../../services/i18n';
  import ExtensionTable from './ExtensionTable.svelte';
  import ExtensionDrillView from './ExtensionDrillView.svelte';
  import SettingsDrillHeader from '../../../components/settings/SettingsDrillHeader.svelte';
  import { DrillState } from './drillState.svelte';

  interface TabNav {
    canBack: boolean;
    canForward: boolean;
    onback: () => void;
    onforward: () => void;
  }

  const NO_NAV: TabNav = {
    canBack: false,
    canForward: false,
    onback: () => {},
    onforward: () => {},
  };

  let { handler, tabNav = NO_NAV }: { handler: SettingsHandler; tabNav?: TabNav } = $props();

  const drill = new DrillState();
  const idOf = (e: ExtensionItem) => e.id ?? e.title;

  const selected = $derived(
    handler.extensions.find((e) => !e.isBuiltIn && idOf(e) === drill.id) ?? null,
  );

  // Deep link (asyar:navigate-settings-tab with a store extensionId, e.g. from
  // the needs-permission-review toast). Waits for the list to load, then
  // consumes the pending id exactly once.
  $effect(() => {
    const pending = handler.pendingExtensionSelection;
    if (!pending || handler.isLoadingExtensions) return;
    if (handler.extensions.length === 0) return;
    const ext = handler.extensions.find((e) => !e.isBuiltIn && idOf(e) === pending);
    if (ext) drill.into(idOf(ext));
    handler.pendingExtensionSelection = null;
  });

  // Clicking the already-active sidebar tab returns to the list.
  let lastResetCounter = handler.tabResetCounter;
  $effect(() => {
    const counter = handler.tabResetCounter;
    if (counter === lastResetCounter) return;
    lastResetCounter = counter;
    if (!handler.pendingExtensionSelection) drill.reset();
  });

  // The drilled extension disappeared (uninstalled / list reloaded): back to the list.
  $effect(() => {
    if (drill.id && !handler.isLoadingExtensions && !selected) drill.reset();
  });
</script>

{#if drill.id && selected}
  <ExtensionDrillView
    {handler}
    extension={selected}
    commandId={drill.commandId}
    parentLabel={t('settings.tabs.extensions')}
    canBack={drill.canBack}
    canForward={drill.canForward}
    onback={() => drill.back()}
    onforward={() => drill.forward()}
    oncommandselect={(cmd) => drill.into(idOf(selected), cmd.id)}
  />
{:else}
  <SettingsDrillHeader
    parentLabel={t('settings.tabs.extensions')}
    canBack={tabNav.canBack}
    canForward={drill.canForward || tabNav.canForward}
    onback={tabNav.onback}
    onforward={drill.canForward ? () => drill.forward() : tabNav.onforward}
  />
  <SettingsCard>
    <div id="advanced-extension-surface">
      <SettingsRow
        label={t('settings.advanced.extension_search')}
        description={t('settings.advanced.extension_search_description')}
      >
        <Toggle
          checked={handler.settings.search?.enableExtensionSearch ?? false}
          onchange={() => handler.handleExtensionSearchToggle()}
        />
      </SettingsRow>
      <SettingsRow
        label={t('settings.advanced.auto_update_extensions')}
        description={t('settings.advanced.auto_update_extensions_description')}
      >
        <Toggle
          checked={handler.settings.extensions?.autoUpdate !== false}
          onchange={() => handler.handleExtensionAutoUpdateToggle()}
        />
      </SettingsRow>
    </div>
  </SettingsCard>

  <ExtensionTable
    {handler}
    scope="third-party"
    onselect={(ext, cmd) => drill.into(idOf(ext), cmd?.id ?? null)}
  />
{/if}
