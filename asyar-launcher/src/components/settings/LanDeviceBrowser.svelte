<script lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import { scanLanDevices, LAN_DEVICE_DISCOVERED_EVENT } from '../../lib/ipc/lanCommands';
  import type { DiscoveredDevice, LanDeviceDiscoveredPayload } from '../../lib/ipc/lanCommands';
  import { appListen } from '../../lib/ipc/bridgeEvents';
  import { t } from '../../services/i18n';
  import Badge from '../base/Badge.svelte';
  import { serviceTypeLabel } from './serviceTypeLabel';

  interface Props {
    serviceTypes?: string[];
    selectedKeys?: Set<string>;
    actionLabel?: string;
    onSelect: (device: DiscoveredDevice) => void;
  }

  let { serviceTypes = [], selectedKeys = new Set(), actionLabel, onSelect }: Props = $props();

  type ScanState = 'idle' | 'scanning' | 'done' | 'os-prompt';
  let scanState = $state<ScanState>('idle');
  let devicesMap = $state(new SvelteMap<string, DiscoveredDevice>());
  let devices = $derived(Array.from(devicesMap.values()));
  let currentScanId = $state('');

  export async function startScan() {
    scanState = 'scanning';
    devicesMap.clear();
    const scanId = crypto.randomUUID();
    currentScanId = scanId;

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await appListen<LanDeviceDiscoveredPayload>(
        LAN_DEVICE_DISCOVERED_EVENT,
        (event) => {
          if (event.payload.scanId !== scanId) return;
          const { host, port } = event.payload.device;
          devicesMap.set(`${host}:${port}`, event.payload.device);
        },
      );

      const finalDevices = await scanLanDevices(scanId, serviceTypes);
      if (currentScanId === scanId) {
        for (const dev of finalDevices) {
          devicesMap.set(`${dev.host}:${dev.port}`, dev);
        }
        scanState = devicesMap.size === 0 ? 'os-prompt' : 'done';
      }
    } catch {
      if (currentScanId === scanId) {
        scanState = 'done';
      }
    } finally {
      unlisten?.();
    }
  }

  $effect(() => {
    startScan();
    return () => {
      currentScanId = '';
    };
  });
</script>

<div class="browser-container">
  {#if scanState === 'scanning' && devices.length === 0}
    <div class="scan-status">{t('settings.extensions.lan_scanning')}</div>
  {:else if scanState === 'os-prompt' && devices.length === 0}
    <div class="scan-status">
      <p>{t('settings.extensions.lan_os_prompt_hint')}</p>
      <button type="button" class="rescan-btn" onclick={startScan}>
        {t('settings.extensions.lan_scan_again')}
      </button>
    </div>
  {:else if scanState === 'done' && devices.length === 0}
    <div class="scan-status">{t('settings.extensions.lan_no_devices_found')}</div>
  {/if}

  {#if devices.length > 0}
    <div class="device-list custom-scrollbar" role="list">
      {#each devices as device (`${device.host}:${device.port}`)}
        {@const key = `${device.host}:${device.port}`}
        {@const typeLabel = serviceTypeLabel(device.protocol, device.serviceType)}
        {@const isSelected = selectedKeys.has(key)}
        <button
          type="button"
          class="device-row"
          onclick={() => onSelect(device)}
          disabled={isSelected}
        >
          <span class="device-details">
            <span class="device-name">{device.name}</span>
            <span class="device-meta">
              <Badge
                text={t(
                  device.protocol === 'ssdp'
                    ? 'settings.extensions.lan_via_ssdp'
                    : 'settings.extensions.lan_via_mdns',
                )}
              />
              {#if typeLabel}<Badge text={typeLabel} mono />{/if}
              <span class="device-addr">{device.host}:{device.port}</span>
            </span>
          </span>
          {#if isSelected}
            <span class="added-badge">{t('settings.extensions.lan_added')}</span>
          {:else}
            <span class="add-hint">{actionLabel ?? t('settings.extensions.lan_tap_to_allow')}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <button type="button" class="rescan-btn" onclick={startScan} disabled={scanState === 'scanning'}>
    {scanState === 'scanning'
      ? t('settings.extensions.lan_scanning')
      : t('settings.extensions.lan_scan_again')}
  </button>
</div>

<style>
  .browser-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .device-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 280px;
    overflow-y: auto;
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
    border-radius: var(--radius-sm);
  }
  .device-name {
    font-weight: 500;
  }
  .device-details {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
  }
  .device-meta {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
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
  .rescan-btn {
    font-size: var(--font-size-sm);
    background: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
    color: var(--text-primary);
    cursor: pointer;
    align-self: flex-start;
  }
  .rescan-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
