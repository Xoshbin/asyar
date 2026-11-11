<script lang="ts">
  import { Textarea, EmptyState } from '../../components';
  import { mcpService } from './mcpService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { runtimeService } from '../../services/runtime/runtimeService.svelte';
  import { formatRuntimeDownloadStatus } from '../../services/runtime/runtimeDownloadStatus';
  import { importServers, type ImportOutcome } from './importServersView.helpers';
  import type { McpServerInstallInput } from './types';
  import Checkbox from '../../components/base/Checkbox.svelte';
  import TabGroup from '../../components/base/TabGroup.svelte';

  type Tab = 'detected' | 'paste';

  let activeTab = $state<Tab>('detected');
  const tabs = $derived([
    { id: 'detected', label: t('features.mcp.tab_detected_configs') },
    { id: 'paste', label: t('features.mcp.tab_paste_json') },
  ]);
  let pasteJson = $state('');
  let parsedServers = $state<McpServerInstallInput[]>([]);
  let parseError = $state<string | null>(null);
  let importing = $state(false);
  let importResults = $state<ImportOutcome[]>([]);

  const importLabel = $derived(
    importing
      ? formatRuntimeDownloadStatus(runtimeService.downloadProgress, 'Importing…')
      : 'Import Selected',
  );

  // Selections: map from id → boolean
  let detectedSelected = $state<Record<string, boolean>>({});
  let parsedSelected = $state<Record<string, boolean>>({});

  const detectedConfigs = $derived(mcpService.detectedConfigs);

  async function handleParse(): Promise<void> {
    parseError = null;
    try {
      const result = await mcpService.parseConfigJson(pasteJson);
      parsedServers = result;
      parsedSelected = {};
    } catch {
      parseError = 'Failed to parse the JSON. Check the format and try again.';
      parsedServers = [];
    }
  }

  async function importSelected(servers: McpServerInstallInput[]): Promise<void> {
    importing = true;
    importResults = [];
    try {
      const outcomes = await importServers(
        servers,
        (input) => mcpService.install(input),
        () => mcpService.installError,
      );
      importResults = outcomes;
      const succeeded = outcomes.filter((o) => o.ok).length;
      const failed = outcomes.length - succeeded;

      if (succeeded > 0) {
        void feedbackService.report({
          source: 'frontend',
          kind: 'mcp_servers_imported',
          severity: 'success',
          retryable: false,
          developerDetail: `Imported ${succeeded} MCP server${succeeded === 1 ? '' : 's'}.`,
          context: { count: String(succeeded) },
        });
      }
      if (failed > 0) {
        void feedbackService.report({
          source: 'frontend',
          kind: 'mcp_servers_import_failed',
          severity: 'warning',
          retryable: false,
          developerDetail: `${failed} of ${outcomes.length} MCP server${outcomes.length === 1 ? '' : 's'} failed to import — see the list below.`,
          context: { count: String(failed), succeeded: String(succeeded) },
        });
      }
      // Only leave the view once every selected server actually imported —
      // a partial or total failure must stay visible with its per-server
      // reason, not silently look identical to success.
      if (failed === 0) {
        viewManager.goBack();
      }
    } finally {
      importing = false;
    }
  }

  function getDetectedSelectedServers(): McpServerInstallInput[] {
    const selected: McpServerInstallInput[] = [];
    for (const config of detectedConfigs) {
      for (const srv of config.servers) {
        if (detectedSelected[`${config.source}:${srv.id}`]) {
          selected.push(srv);
        }
      }
    }
    return selected;
  }

  function getParsedSelectedServers(): McpServerInstallInput[] {
    return parsedServers.filter((s) => parsedSelected[s.id]);
  }

  async function handleImportDetected(): Promise<void> {
    await importSelected(getDetectedSelectedServers());
  }

  async function handleImportParsed(): Promise<void> {
    await importSelected(getParsedSelectedServers());
  }

  const activeSelectedCount = $derived(
    activeTab === 'detected'
      ? getDetectedSelectedServers().length
      : getParsedSelectedServers().length,
  );

  // Auto-parse valid JSON pasted into the Paste JSON tab so users don't need a Parse button.
  $effect(() => {
    if (activeTab !== 'paste') return;
    const raw = pasteJson;
    if (!raw.trim()) {
      parsedServers = [];
      parsedSelected = {};
      parseError = null;
      return;
    }
    const timer = setTimeout(() => {
      void handleParse();
    }, 200);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const label = importLabel;
    const disabled = importing || activeSelectedCount === 0;
    const tab = activeTab;
    actionService.registerAction({
      id: 'mcp:import-submit',
      label,
      icon: '📥',
      shortcut: 'Mod+Enter',
      primary: true,
      category: t('categories.mcp'),
      extensionId: 'mcp',
      context: ActionContext.EXTENSION_VIEW,
      disabled,
      execute: () => (tab === 'detected' ? handleImportDetected() : handleImportParsed()),
    });
    return () => {
      actionService.unregisterAction('mcp:import-submit');
    };
  });

  $effect(() => {
    if (activeTab !== 'paste') {
      actionService.unregisterAction('mcp:parse-json');
      return;
    }
    const disabled = !pasteJson.trim();
    actionService.registerAction({
      id: 'mcp:parse-json',
      label: t('features.mcp.ui.parse'),
      icon: '🔍',
      shortcut: 'Mod+Shift+P',
      category: t('categories.mcp'),
      extensionId: 'mcp',
      context: ActionContext.EXTENSION_VIEW,
      disabled,
      execute: () => handleParse(),
    });
    return () => {
      actionService.unregisterAction('mcp:parse-json');
    };
  });
</script>

<div class="import-view">
  <TabGroup {tabs} bind:activeTab variant="underline" />

  <div class="tab-content custom-scrollbar">
    {#if activeTab === 'detected'}
      {#if detectedConfigs.length === 0}
        <EmptyState compact message={t('features.mcp.no_configs')} />
      {:else}
        {#each detectedConfigs as config (config.path)}
          <div class="config-group">
            <div class="config-source">
              <strong>{config.source}</strong>
              <span class="config-path">{config.path}</span>
            </div>
            {#each config.servers as srv (srv.id)}
              <label class="server-checkbox">
                <Checkbox
                  checked={!!detectedSelected[`${config.source}:${srv.id}`]}
                  onchange={(v) => {
                    detectedSelected[`${config.source}:${srv.id}`] = v;
                  }}
                />
                <span class="srv-name">{srv.displayName}</span>
                {#if srv.description}
                  <span class="srv-desc">{srv.description}</span>
                {/if}
              </label>
            {/each}
          </div>
        {/each}
        {@render importResultsList()}
      {/if}
    {:else}
      <div class="paste-section">
        <Textarea
          unstyled
          textIntent="exact"
          class="field-textarea paste-area"
          placeholder={t('features.mcp.ui.import_placeholder')}
          bind:value={pasteJson}
          rows={8}
        ></Textarea>
        {#if parseError}
          <p class="parse-error">{parseError}</p>
        {/if}

        {#if parsedServers.length > 0}
          <div class="parsed-results">
            <p class="parsed-count">{parsedServers.length} server(s) found:</p>
            {#each parsedServers as srv (srv.id)}
              <label class="server-checkbox">
                <Checkbox
                  checked={!!parsedSelected[srv.id]}
                  onchange={(v) => {
                    parsedSelected[srv.id] = v;
                  }}
                />
                <span class="srv-name">{srv.displayName}</span>
                {#if srv.description}
                  <span class="srv-desc">{srv.description}</span>
                {/if}
              </label>
            {/each}
            {@render importResultsList()}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

{#snippet importResultsList()}
  {#if importResults.length > 0}
    <div class="import-results">
      {#each importResults as outcome (outcome.id)}
        <div class="import-result" class:import-result-fail={!outcome.ok}>
          <span class="result-name">{outcome.displayName}</span>
          {#if outcome.ok}
            <span class="result-status result-ok">{t('features.mcp.ui.imported')}</span>
          {:else}
            <span class="result-status result-fail-text">{outcome.error}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<style>
  .import-view {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
  }

  .config-group {
    margin-bottom: var(--space-4);
  }

  .config-source {
    display: flex;
    flex-direction: column;
    margin-bottom: var(--space-2);
  }

  .config-path {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }

  .server-checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
    cursor: default;
    font-size: var(--font-size-sm);
  }

  .srv-name {
    font-weight: 500;
  }

  .srv-desc {
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
  }

  .paste-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  :global(.paste-area) {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }

  .parse-error {
    color: var(--accent-danger);
    font-size: var(--font-size-xs);
    margin: 0;
  }

  .parsed-results {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-2);
  }

  .parsed-count {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    margin: 0;
  }

  .import-results {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-3);
  }

  .import-result {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    font-size: var(--font-size-xs);
  }

  .import-result-fail {
    border-left: 2px solid var(--accent-danger);
  }

  .result-name {
    font-weight: 500;
    color: var(--text-primary);
  }

  .result-ok {
    color: var(--text-tertiary);
  }

  .result-fail-text {
    color: var(--accent-danger);
  }
</style>
