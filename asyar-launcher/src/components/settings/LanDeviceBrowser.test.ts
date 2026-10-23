import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import type { DiscoveredDevice, LanDeviceDiscoveredPayload } from '../../lib/ipc/lanCommands';

describe('LanDeviceBrowser streaming deduplication logic', () => {
  it('ignores events with non-current scanId', () => {
    const activeScanId = 'scan-current';
    const devicesMap = new SvelteMap<string, DiscoveredDevice>();

    function onEvent(payload: LanDeviceDiscoveredPayload) {
      if (payload.scanId !== activeScanId) return;
      const { host, port } = payload.device;
      devicesMap.set(`${host}:${port}`, payload.device);
    }

    onEvent({
      scanId: 'scan-old',
      device: {
        name: 'Old TV',
        host: '192.168.1.100',
        port: 8008,
        protocol: 'ssdp',
        serviceType: '',
      },
    });
    expect(devicesMap.size).toBe(0);

    onEvent({
      scanId: 'scan-current',
      device: {
        name: 'Current TV',
        host: '192.168.1.100',
        port: 8008,
        protocol: 'mdns',
        serviceType: '_googlecast._tcp.local.',
      },
    });
    expect(devicesMap.size).toBe(1);
    expect(devicesMap.get('192.168.1.100:8008')?.name).toBe('Current TV');
  });

  it('replaces earlier row for the same host:port (last-write-wins reproduces Rust ranking)', () => {
    const activeScanId = 'scan-1';
    const devicesMap = new SvelteMap<string, DiscoveredDevice>();

    function onEvent(payload: LanDeviceDiscoveredPayload) {
      if (payload.scanId !== activeScanId) return;
      const { host, port } = payload.device;
      devicesMap.set(`${host}:${port}`, payload.device);
    }

    // First arrival: SSDP raw name
    onEvent({
      scanId: 'scan-1',
      device: {
        name: 'Linux/5.4 UPnP Chromecast',
        host: '192.168.1.172',
        port: 8008,
        protocol: 'ssdp',
        serviceType: '',
      },
    });
    expect(devicesMap.get('192.168.1.172:8008')?.name).toBe('Linux/5.4 UPnP Chromecast');

    // Upgrade arrival: mDNS friendly name
    onEvent({
      scanId: 'scan-1',
      device: {
        name: 'Family Room TV',
        host: '192.168.1.172',
        port: 8008,
        protocol: 'mdns',
        serviceType: '_googlecast._tcp.local.',
      },
    });
    expect(devicesMap.size).toBe(1);
    expect(devicesMap.get('192.168.1.172:8008')?.name).toBe('Family Room TV');
    expect(devicesMap.get('192.168.1.172:8008')?.protocol).toBe('mdns');
  });
});
