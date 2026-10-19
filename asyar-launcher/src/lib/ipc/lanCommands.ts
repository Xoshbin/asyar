import { invokeRaw } from './invokeSafe';

export interface LanAllowedHost {
  id: string;
  extensionId: string;
  host: string;
  port: number;
  label: string;
  createdAt: number;
}

export interface DiscoveredDevice {
  name: string;
  host: string;
  port: number;
  protocol: 'ssdp' | 'mdns';
  serviceType: string;
}

export interface LanDevice {
  host: string;
  port: number;
  label: string;
}

export const LAN_DEVICE_DISCOVERED_EVENT = 'asyar:lan-device-discovered';
export interface LanDeviceDiscoveredPayload {
  scanId: string;
  device: DiscoveredDevice;
}

export async function lanHostsList(extensionId: string): Promise<LanAllowedHost[]> {
  return invokeRaw<LanAllowedHost[]>('lan_hosts_list', { extensionId });
}

export async function lanHostsAdd(
  extensionId: string,
  host: string,
  port: number,
  label: string,
): Promise<LanAllowedHost> {
  return invokeRaw<LanAllowedHost>('lan_hosts_add', { extensionId, host, port, label });
}

export async function lanHostsRemove(
  extensionId: string,
  host: string,
  port: number,
): Promise<boolean> {
  return invokeRaw<boolean>('lan_hosts_remove', { extensionId, host, port });
}

export async function scanLanDevices(
  scanId: string,
  customServices?: string[],
): Promise<DiscoveredDevice[]> {
  return invokeRaw<DiscoveredDevice[]>('scan_lan_devices', { scanId, customServices });
}

export async function lanHostValidate(host: string, port: number): Promise<void> {
  return invokeRaw<void>('lan_host_validate', { host, port });
}

export async function lanDevicesForCaller(callerExtensionId: string | null): Promise<LanDevice[]> {
  return invokeRaw<LanDevice[]>('lan_devices_for_caller', { callerExtensionId });
}
