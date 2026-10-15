<script lang="ts">
  import { scanLanDevices, lanHostsAdd } from '../../lib/ipc/lanCommands';
  import type { DiscoveredDevice, LanAllowedHost } from '../../lib/ipc/lanCommands';

  interface Props {
    extensionId: string;
    onClose: () => void;
    onDeviceAdded: (host: LanAllowedHost) => void;
  }

  let { extensionId, onClose, onDeviceAdded }: Props = $props();

  type ScanState = 'idle' | 'scanning' | 'done' | 'os-prompt';
  let scanState = $state<ScanState>('idle');
  let devices = $state<DiscoveredDevice[]>([]);
  let addedHosts = $state(new Set<string>());

  async function startScan() {
    scanState = 'scanning';
    devices = [];
    try {
      const found = await scanLanDevices();
      devices = found;
      scanState = found.length === 0 ? 'os-prompt' : 'done';
    } catch {
      scanState = 'done';
    }
  }

  async function selectDevice(device: DiscoveredDevice) {
    const key = `${device.host}:${device.port}`;
    if (addedHosts.has(key)) return;
    const added = await lanHostsAdd(extensionId, device.host, device.port, device.name);
    addedHosts = new Set([...addedHosts, key]);
    onDeviceAdded(added);
  }

  $effect(() => {
    startScan();
  });
</script>

<div class="scan-sheet">
  <div class="scan-header">
    <span>Discovered devices</span>
    <button class="close-btn" onclick={onClose}>Done</button>
  </div>

  {#if scanState === 'scanning'}
    <div class="scan-status">Scanning…</div>
  {:else if scanState === 'os-prompt'}
    <div class="scan-status">
      <p>No devices found. If prompted, allow Asyar to access the local network and scan again.</p>
      <button onclick={startScan}>Scan again</button>
    </div>
  {:else if scanState === 'done' && devices.length === 0}
    <div class="scan-status">No devices found on your network.</div>
  {:else}
    {#each devices as device (`${device.host}:${device.port}`)}
      {@const key = `${device.host}:${device.port}`}
      <button
        class="device-row"
        onclick={() => selectDevice(device)}
        disabled={addedHosts.has(key)}
      >
        <span class="device-name">{device.name}</span>
        <span class="device-addr">{device.host}:{device.port}</span>
        {#if addedHosts.has(key)}
          <span class="added-badge">Added</span>
        {:else}
          <span class="add-hint">Tap to allow</span>
        {/if}
      </button>
    {/each}
  {/if}

  <button class="rescan-btn" onclick={startScan} disabled={scanState === 'scanning'}>
    {scanState === 'scanning' ? 'Scanning…' : 'Scan again'}
  </button>
</div>

<style>
  .scan-sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .scan-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .device-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1) 0;
    text-align: left;
  }
  .device-name {
    flex: 1;
    font-weight: 500;
  }
  .device-addr {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .added-badge {
    color: var(--accent-success);
    font-size: var(--font-size-sm);
  }
  .add-hint {
    color: var(--accent-primary);
    font-size: var(--font-size-sm);
  }
  .scan-status {
    padding: var(--space-2);
    color: var(--text-secondary);
  }
  .close-btn,
  .rescan-btn {
    font-size: var(--font-size-sm);
  }
</style>
