import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageServiceProxy } from './StorageServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new StorageServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('StorageServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get → "storage:get" with key', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue('value1');
    const result = await proxy.get('myKey');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'storage:get',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ key: 'myKey' });
    expect(result).toBe('value1');
  });

  it('set → "storage:set" with key and value', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.set('myKey', 'myValue');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'storage:set',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ key: 'myKey', value: 'myValue' });
  });

  it('delete → "storage:delete" with key', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    const result = await proxy.delete('myKey');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'storage:delete',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ key: 'myKey' });
    expect(result).toBe(true);
  });

  it('getAll → "storage:getAll"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const data = { a: '1', b: '2' };
    mockInvoke.mockResolvedValue(data);
    const result = await proxy.getAll();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'storage:getAll',
    );
    expect(call).toBeDefined();
    expect(result).toEqual(data);
  });

  it('clear → "storage:clear"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(5);
    const result = await proxy.clear();
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'storage:clear',
    );
    expect(call).toBeDefined();
    expect(result).toBe(5);
  });
});
