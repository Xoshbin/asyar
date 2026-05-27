<script lang="ts">
  import { mcpService } from './mcpService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import type { McpServerInstallInput, DetectedConfig } from './types';
  import Button from '../../components/base/Button.svelte';
  import Checkbox from '../../components/base/Checkbox.svelte';
  import TabGroup from '../../components/base/TabGroup.svelte';

  type Tab = 'detected' | 'paste';

  let activeTab = $state<Tab>('detected');
  const tabs = [
    { id: 'detected', label: 'From Detected Configs' },
    { id: 'paste', label: 'Paste JSON' },
  ];
  let pasteJson = $state('');
  let parsedServers = $state<McpServerInstallInput[]>([]);
  let parseError = $state<string | null>(null);
  let importing = $state(false);

  // Selections: map from id → boolean
  let detectedSelected = $state<Record<string, boolean>>({});
  let parsedSelected = $state<Record<string, boolean>>({});

  const detectedConfigs = $derived(mcpService.detectedConfigs);

  async function handleParse(): Promise<void> {
    parseError = null;
    const result = await mcpService.parseConfigJson(pasteJson);
    if (result === null) {
      parseError = 'Failed to parse the JSON. Check the format and try again.';
      parsedServers = [];
    } else {
      parsedServers = result;
      parsedSelected = {};
    }
  }

  async function importSelected(servers: McpServerInstallInput[]): Promise<void> {
    importing = true;
    let succeeded = 0;
    let failed = 0;
    try {
      for (const input of servers) {
        const result = await mcpService.install(input);
        if (result !== null) succeeded += 1;
        else failed += 1;
      }
      if (succeeded > 0) {
        void diagnosticsService.report({
          source: 'frontend',
          kind: 'mcp_servers_imported',
          severity: 'success',
          retryable: false,
          context: { count: String(succeeded) },
        });
      }
      if (failed > 0) {
        void diagnosticsService.report({
          source: 'frontend',
          kind: 'mcp_servers_import_failed',
          severity: 'warning',
          retryable: false,
          context: { count: String(failed), succeeded: String(succeeded) },
        });
      }
      viewManager.goBack();
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
</script>

<div class="import-view">
  <TabGroup {tabs} bind:activeTab variant="underline" />

  <div class="tab-content">
    {#if activeTab === 'detected'}
      {#if detectedConfigs.length === 0}
        <p class="empty-msg">No existing MCP configs detected on this system.</p>
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
                  onchange={(v) => { detectedSelected[`${config.source}:${srv.id}`] = v; }}
                />
                <span class="srv-name">{srv.displayName}</span>
                {#if srv.description}
                  <span class="srv-desc">{srv.description}</span>
                {/if}
              </label>
            {/each}
          </div>
        {/each}
        <div class="import-btn">
          <Button
            onclick={handleImportDetected}
            disabled={importing || getDetectedSelectedServers().length === 0}
          >
            {importing ? 'Importing…' : 'Import Selected'}
          </Button>
        </div>
      {/if}
    {:else}
      <div class="paste-section">
        <textarea
          class="field-textarea paste-area"
          placeholder="Paste MCP config JSON here"
          bind:value={pasteJson}
          rows={8}
        ></textarea>
        <div>
          <Button onclick={handleParse} disabled={!pasteJson.trim()}>
            Parse
          </Button>
        </div>
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
                  onchange={(v) => { parsedSelected[srv.id] = v; }}
                />
                <span class="srv-name">{srv.displayName}</span>
                {#if srv.description}
                  <span class="srv-desc">{srv.description}</span>
                {/if}
              </label>
            {/each}
            <div class="import-btn">
              <Button
                onclick={handleImportParsed}
                disabled={importing || getParsedSelectedServers().length === 0}
              >
                {importing ? 'Importing…' : 'Import Selected'}
              </Button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

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

  .empty-msg {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
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
    cursor: pointer;
    font-size: var(--font-size-sm);
  }

  .srv-name {
    font-weight: 500;
  }

  .srv-desc {
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
  }

  .import-btn {
    margin-top: var(--space-3);
  }

  .paste-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .paste-area {
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
</style>
