<script lang="ts">
  import { mcpService } from './mcpService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import {
    validateInstallForm,
    buildInstallInput,
    type InstallFormState,
    type EnvRow,
  } from './installServerView.helpers';
  import type { McpTestResult } from './types';
  import Button from '../../components/base/Button.svelte';
  import SegmentedControl from '../../components/base/SegmentedControl.svelte';

  const transportOptions = [
    { value: 'stdio', label: 'Stdio' },
    { value: 'http', label: 'HTTP' },
  ];

  let form = $state<InstallFormState>({
    id: '',
    displayName: '',
    description: '',
    transportKind: 'stdio',
    command: '',
    args: [''],
    env: [{ key: '', value: '' }],
    cwd: '',
    url: '',
    headers: [{ key: '', value: '' }],
  });

  let testResult = $state<McpTestResult | null>(null);
  let testing = $state(false);
  let installing = $state(false);
  let validationError = $state<string | null>(null);

  const validation = $derived(validateInstallForm(form));

  function addArg(): void {
    form.args = [...form.args, ''];
  }

  function removeArg(i: number): void {
    form.args = form.args.filter((_, idx) => idx !== i);
  }

  function addEnvRow(): void {
    form.env = [...form.env, { key: '', value: '' }];
  }

  function removeEnvRow(i: number): void {
    form.env = form.env.filter((_, idx) => idx !== i);
  }

  function addHeader(): void {
    form.headers = [...form.headers, { key: '', value: '' }];
  }

  function removeHeader(i: number): void {
    form.headers = form.headers.filter((_, idx) => idx !== i);
  }

  function updateArg(i: number, value: string): void {
    const next = [...form.args];
    next[i] = value;
    form.args = next;
  }

  function updateEnvRow(i: number, field: keyof EnvRow, value: string): void {
    const next = form.env.map((r, idx) => idx === i ? { ...r, [field]: value } : r);
    form.env = next;
  }

  function updateHeader(i: number, field: keyof EnvRow, value: string): void {
    const next = form.headers.map((r, idx) => idx === i ? { ...r, [field]: value } : r);
    form.headers = next;
  }

  async function handleTest(): Promise<void> {
    validationError = null;
    if (!validation.ok) {
      validationError = validation.error;
      return;
    }
    testing = true;
    testResult = null;
    try {
      testResult = await mcpService.test(buildInstallInput(form));
    } finally {
      testing = false;
    }
  }

  async function handleInstall(): Promise<void> {
    validationError = null;
    if (!validation.ok) {
      validationError = validation.error;
      return;
    }
    installing = true;
    try {
      const result = await mcpService.install(buildInstallInput(form));
      if (result !== null) {
        void diagnosticsService.report({
          source: 'frontend',
          kind: 'mcp_server_installed',
          severity: 'success',
          retryable: false,
          context: { serverId: result.id },
        });
        viewManager.goBack();
      }
    } finally {
      installing = false;
    }
  }
</script>

<div class="install-view">
  <form class="install-form custom-scrollbar" onsubmit={(e) => e.preventDefault()}>
    <!-- ID -->
    <div class="field">
      <label for="srv-id" class="field-label">ID <span class="required">*</span></label>
      <input
        id="srv-id"
        class="field-input"
        type="text"
        placeholder="my-server"
        bind:value={form.id}
      />
    </div>

    <!-- Display Name -->
    <div class="field">
      <label for="srv-name" class="field-label">Display Name <span class="required">*</span></label>
      <input
        id="srv-name"
        class="field-input"
        type="text"
        placeholder="My Server"
        bind:value={form.displayName}
      />
    </div>

    <!-- Description -->
    <div class="field">
      <label for="srv-desc" class="field-label">Description</label>
      <textarea
        id="srv-desc"
        class="field-input"
        placeholder="Optional description"
        rows={2}
        bind:value={form.description}
      ></textarea>
    </div>

    <!-- Transport Kind -->
    <div class="field">
      <span class="field-label">Transport</span>
      <SegmentedControl options={transportOptions} bind:value={form.transportKind} />
    </div>

    {#if form.transportKind === 'stdio'}
      <!-- Command -->
      <div class="field">
        <label for="srv-cmd" class="field-label">Command <span class="required">*</span></label>
        <input
          id="srv-cmd"
          class="field-input"
          type="text"
          placeholder="npx"
          bind:value={form.command}
        />
      </div>

      <!-- Args -->
      <div class="field">
        <span class="field-label">Arguments</span>
        {#each form.args as arg, i (i)}
          <div class="array-row">
            <input
              class="field-input"
              type="text"
              placeholder="arg"
              value={arg}
              oninput={(e) => updateArg(i, (e.target as HTMLInputElement).value)}
            />
            <button type="button" class="remove-btn" onclick={() => removeArg(i)}>−</button>
          </div>
        {/each}
        <button type="button" class="add-btn" onclick={addArg}>+ Add Argument</button>
      </div>

      <!-- Env vars -->
      <div class="field">
        <span class="field-label">Environment Variables</span>
        {#each form.env as row, i (i)}
          <div class="kv-row">
            <input
              class="field-input kv-key"
              type="text"
              placeholder="KEY"
              value={row.key}
              oninput={(e) => updateEnvRow(i, 'key', (e.target as HTMLInputElement).value)}
            />
            <input
              class="field-input kv-val"
              type="text"
              placeholder="value"
              value={row.value}
              oninput={(e) => updateEnvRow(i, 'value', (e.target as HTMLInputElement).value)}
            />
            <button type="button" class="remove-btn" onclick={() => removeEnvRow(i)}>−</button>
          </div>
        {/each}
        <button type="button" class="add-btn" onclick={addEnvRow}>+ Add Variable</button>
      </div>

      <!-- CWD -->
      <div class="field">
        <label for="srv-cwd" class="field-label">Working Directory</label>
        <input
          id="srv-cwd"
          class="field-input"
          type="text"
          placeholder="/optional/working/directory"
          bind:value={form.cwd}
        />
      </div>
    {:else}
      <!-- URL -->
      <div class="field">
        <label for="srv-url" class="field-label">URL <span class="required">*</span></label>
        <input
          id="srv-url"
          class="field-input"
          type="url"
          placeholder="https://example.com/mcp"
          bind:value={form.url}
        />
      </div>

      <!-- Headers -->
      <div class="field">
        <span class="field-label">Headers</span>
        {#each form.headers as row, i (i)}
          <div class="kv-row">
            <input
              class="field-input kv-key"
              type="text"
              placeholder="Header-Name"
              value={row.key}
              oninput={(e) => updateHeader(i, 'key', (e.target as HTMLInputElement).value)}
            />
            <input
              class="field-input kv-val"
              type="text"
              placeholder="value"
              value={row.value}
              oninput={(e) => updateHeader(i, 'value', (e.target as HTMLInputElement).value)}
            />
            <button type="button" class="remove-btn" onclick={() => removeHeader(i)}>−</button>
          </div>
        {/each}
        <button type="button" class="add-btn" onclick={addHeader}>+ Add Header</button>
      </div>
    {/if}

    {#if validationError}
      <p class="validation-error">{validationError}</p>
    {/if}

    {#if testResult !== null}
      <div class="test-result" class:test-ok={testResult.error === null} class:test-fail={testResult.error !== null}>
        {#if testResult.error === null}
          Tools found: {testResult.toolsCount}
        {:else}
          Error: {testResult.error}
        {/if}
      </div>
    {/if}

    <div class="form-actions">
      <Button onclick={handleTest} disabled={testing}>
        {testing ? 'Testing…' : 'Test Connection'}
      </Button>
      <Button class="btn-primary" onclick={handleInstall} disabled={installing}>
        {installing ? 'Installing…' : 'Install'}
      </Button>
      <Button onclick={() => viewManager.goBack()}>
        Cancel
      </Button>
    </div>
  </form>
</div>

<style>
  .install-view {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .install-form {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .required {
    color: var(--accent-danger);
  }

  .array-row,
  .kv-row {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    margin-bottom: var(--space-1);
  }

  .kv-key {
    flex: 0 0 40%;
  }

  .kv-val {
    flex: 1;
  }

  .add-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--font-size-xs);
    padding: var(--space-1) 0;
    text-align: left;
  }

  .add-btn:hover {
    color: var(--text-primary);
  }

  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    padding: 0 var(--space-1);
  }

  .remove-btn:hover {
    color: var(--accent-danger);
  }

  .validation-error {
    color: var(--accent-danger);
    font-size: var(--font-size-xs);
    margin: 0;
  }

  .test-result {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
  }

  .test-ok {
    background: color-mix(in srgb, var(--accent-success) 15%, transparent);
    color: var(--accent-success);
  }

  .test-fail {
    background: color-mix(in srgb, var(--accent-danger) 15%, transparent);
    color: var(--accent-danger);
  }

  .form-actions {
    display: flex;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }
</style>
