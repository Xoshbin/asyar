import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationServiceProxy } from './NotificationServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({ invoke: vi.fn(), on: vi.fn(), off: vi.fn() })),
  },
}));

function makeProxy(resolved: unknown = undefined) {
  const mockInvoke = vi.fn().mockResolvedValue(resolved);
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke, on: vi.fn(), off: vi.fn(),
  } as any);
  const proxy = new NotificationServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('NotificationServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('send', () => {
    it('sends notifications:send with the full options payload and returns the id', async () => {
      const { proxy, mockInvoke } = makeProxy('notif-123');
      const id = await proxy.send({ title: 'T', body: 'B' });
      expect(mockInvoke.mock.calls[0][0]).toBe('notifications:send');
      expect(mockInvoke.mock.calls[0][1]).toEqual({ options: { title: 'T', body: 'B' } });
      expect(id).toBe('notif-123');
    });

    it('forwards actions array on the options payload', async () => {
      const { proxy, mockInvoke } = makeProxy('notif-xyz');
      await proxy.send({
        title: 'Coffee ending',
        actions: [
          { id: 'extend', title: 'Extend 30m', commandId: 'coffee.extend', args: { minutes: 30 } },
          { id: 'stop', title: 'Stop now', commandId: 'coffee.stop' },
        ],
      });
      const payload = mockInvoke.mock.calls[0][1];
      expect(payload.options.actions).toHaveLength(2);
      expect(payload.options.actions[0]).toEqual({
        id: 'extend', title: 'Extend 30m', commandId: 'coffee.extend', args: { minutes: 30 },
      });
      expect(payload.options.actions[1]).toEqual({
        id: 'stop', title: 'Stop now', commandId: 'coffee.stop',
      });
    });

    it('rejects actions without a commandId before reaching IPC', async () => {
      const { proxy, mockInvoke } = makeProxy();
      await expect(
        proxy.send({
          title: 'x',
          actions: [{ id: 'a', title: 'A', commandId: '' }],
        }),
      ).rejects.toThrow(/commandId/i);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('rejects actions with missing id or title', async () => {
      const { proxy, mockInvoke } = makeProxy();
      await expect(
        proxy.send({ title: 'x', actions: [{ id: '', title: 'A', commandId: 'cmd.a' }] }),
      ).rejects.toThrow(/id/i);
      await expect(
        proxy.send({ title: 'x', actions: [{ id: 'a', title: '', commandId: 'cmd.a' }] }),
      ).rejects.toThrow(/title/i);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('rejects actions whose args are not JSON-serialisable', async () => {
      const { proxy, mockInvoke } = makeProxy();
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      await expect(
        proxy.send({
          title: 'x',
          actions: [{ id: 'a', title: 'A', commandId: 'cmd.a', args: cyclic }],
        }),
      ).rejects.toThrow(/serial/i);
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('sends notifications:dismiss with the notification id', async () => {
      const { proxy, mockInvoke } = makeProxy();
      await proxy.dismiss('notif-abc');
      expect(mockInvoke.mock.calls[0][0]).toBe('notifications:dismiss');
      expect(mockInvoke.mock.calls[0][1]).toEqual({ notificationId: 'notif-abc' });
    });
  });

  describe('permissions', () => {
    it('checkPermission maps to notifications:checkPermission', async () => {
      const { proxy, mockInvoke } = makeProxy(true);
      await proxy.checkPermission();
      expect(mockInvoke.mock.calls[0][0]).toBe('notifications:checkPermission');
    });

    it('requestPermission maps to notifications:requestPermission', async () => {
      const { proxy, mockInvoke } = makeProxy(true);
      await proxy.requestPermission();
      expect(mockInvoke.mock.calls[0][0]).toBe('notifications:requestPermission');
    });
  });
});
