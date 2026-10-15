<script lang="ts">
  import Icon from '../base/Icon.svelte';
  import { lanHostsList, lanHostsAdd, lanHostsRemove } from '../../lib/ipc/lanCommands';
  import type { LanAllowedHost } from '../../lib/ipc/lanCommands';

  interface Props {
    extensionId: string;
    onOpenScan: () => void;
  }

  let { extensionId, onOpenScan }: Props = $props();

  let hosts = $state<LanAllowedHost[]>([]);
  let isAdding = $state(false);
  let newHost = $state('');
  let newPort = $state('');
  let addError = $state('');

  $effect(() => {
    lanHostsList(extensionId).then((list) => {
      hosts = list;
    });
  });

  export function refresh() {
    lanHostsList(extensionId).then((list) => {
      hosts = list;
    });
  }

  async function handleAdd() {
    const portNum = parseInt(newPort, 10);
    if (!newHost || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      addError = 'Enter a valid host and port (1–65535).';
      return;
    }
    addError = '';
    try {
      const added = await lanHostsAdd(extensionId, newHost.trim(), portNum, '');
      hosts = [...hosts, added];
      newHost = '';
      newPort = '';
      isAdding = false;
    } catch (e: any) {
      addError = e?.message ?? 'Could not add host.';
    }
  }

  async function handleRemove(host: string, port: number) {
    await lanHostsRemove(extensionId, host, port);
    hosts = hosts.filter((h) => !(h.host === host && h.port === port));
  }
</script>

<div class="lan-host-list">
  <div class="lan-header">
    <button class="scan-btn" onclick={onOpenScan}>Scan for devices</button>
  </div>

  {#each hosts as h (h.id)}
    <div class="lan-row">
      <span class="lan-address">{h.host}:{h.port}</span>
      {#if h.label}
        <span class="lan-label">{h.label}</span>
      {/if}
      <button class="remove-btn" onclick={() => handleRemove(h.host, h.port)} aria-label="Remove">
        <Icon name="close" size={12} />
      </button>
    </div>
  {/each}

  {#if isAdding}
    <div class="add-row">
      <input
        class="host-input"
        placeholder="host or IP"
        bind:value={newHost}
        onkeydown={(e) => e.key === 'Enter' && handleAdd()}
      />
      <input
        class="port-input"
        placeholder="port"
        bind:value={newPort}
        onkeydown={(e) => e.key === 'Enter' && handleAdd()}
      />
      <button class="confirm-btn" onclick={handleAdd}>Add</button>
      <button
        class="cancel-btn"
        onclick={() => {
          isAdding = false;
          addError = '';
        }}>Cancel</button
      >
    </div>
    {#if addError}
      <p class="add-error">{addError}</p>
    {/if}
  {:else}
    <button class="add-device-btn" onclick={() => (isAdding = true)}>+ Add device</button>
  {/if}
</div>

<style>
  .lan-host-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .lan-header {
    display: flex;
    justify-content: flex-end;
  }
  .lan-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }
  .lan-address {
    font-family: var(--font-mono);
    font-size: var(--font-size-md);
    flex: 1;
  }
  .lan-label {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .remove-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
  }
  .add-row {
    display: flex;
    gap: var(--space-1);
    align-items: center;
  }
  .host-input {
    flex: 2;
  }
  .port-input {
    flex: 1;
    max-width: 80px;
  }
  .add-error {
    color: var(--accent-danger);
    font-size: var(--font-size-sm);
    margin: 0;
  }
  .scan-btn,
  .add-device-btn {
    font-size: var(--font-size-sm);
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
  }
</style>
