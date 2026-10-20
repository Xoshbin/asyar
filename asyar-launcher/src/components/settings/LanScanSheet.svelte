<script lang="ts">
  import { lanHostsAdd } from '../../lib/ipc/lanCommands';
  import type { DiscoveredDevice, LanAllowedHost } from '../../lib/ipc/lanCommands';
  import { t } from '../../services/i18n';
  import LanDeviceBrowser from './LanDeviceBrowser.svelte';

  interface Props {
    extensionId: string;
    onClose: () => void;
    onDeviceAdded: (host: LanAllowedHost) => void;
  }

  let { extensionId, onClose, onDeviceAdded }: Props = $props();
  let addedHosts = $state(new Set<string>());

  async function selectDevice(device: DiscoveredDevice) {
    const key = `${device.host}:${device.port}`;
    if (addedHosts.has(key)) return;
    const added = await lanHostsAdd(extensionId, device.host, device.port, device.name);
    addedHosts = new Set([...addedHosts, key]);
    onDeviceAdded(added);
  }
</script>

<div class="scan-sheet">
  <div class="scan-header">
    <span class="scan-title">{t('settings.extensions.lan_discovered_devices')}</span>
    <button type="button" class="close-btn" onclick={onClose}>{t('common.done')}</button>
  </div>

  <LanDeviceBrowser selectedKeys={addedHosts} onSelect={selectDevice} />
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
  .scan-title {
    font-weight: 500;
  }
  .close-btn {
    font-size: var(--font-size-sm);
    background: none;
    border: none;
    color: var(--accent-primary);
    cursor: pointer;
  }
</style>
