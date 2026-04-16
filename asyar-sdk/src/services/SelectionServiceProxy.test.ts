import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelectionServiceProxy } from './SelectionServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  } as any);
  const proxy = new SelectionServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('SelectionServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSelectedText → "selection:getSelectedText"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue('hello world');
    const result = await proxy.getSelectedText();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'selection:getSelectedText',
    );
    expect(call).toBeDefined();
    expect(result).toBe('hello world');
  });

  it('getSelectedFinderItems → "selection:getSelectedFinderItems"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(['/path/a', '/path/b']);
    const result = await proxy.getSelectedFinderItems();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'selection:getSelectedFinderItems',
    );
    expect(call).toBeDefined();
    expect(result).toEqual(['/path/a', '/path/b']);
  });
});
