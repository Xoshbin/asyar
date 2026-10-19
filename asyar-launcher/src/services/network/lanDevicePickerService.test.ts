import { describe, expect, it } from 'vitest';
import { LanDevicePickerService } from './lanDevicePickerService.svelte';

const request = (extensionId: string) => ({
  extensionId,
  extensionName: extensionId,
  mode: 'discover' as const,
  allowManualEntry: true,
});

describe('LanDevicePickerService', () => {
  it('serializes requests and resolves cancellation as null', async () => {
    const service = new LanDevicePickerService();
    const first = service.request(request('one'));
    const second = service.request(request('two'));
    expect(service.activePicker?.extensionId).toBe('one');
    service.onCancelled();
    await expect(first).resolves.toBeNull();
    expect(service.activePicker?.extensionId).toBe('two');
    service.onPicked({ host: '192.168.1.2', port: 80, label: 'Device' });
    await expect(second).resolves.toEqual({ host: '192.168.1.2', port: 80, label: 'Device' });
  });

  it('rejects duplicate requests and bounds the queue', async () => {
    const service = new LanDevicePickerService();
    void service.request(request('one'));
    await expect(service.request(request('one'))).rejects.toThrow('LAN_PICKER_ALREADY_OPEN');
    void service.request(request('two'));
    void service.request(request('three'));
    void service.request(request('four'));
    await expect(service.request(request('five'))).rejects.toThrow('LAN_PICKER_BUSY');
  });
});
