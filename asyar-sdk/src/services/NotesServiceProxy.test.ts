import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotesServiceProxy } from './NotesServiceProxy';
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
  const proxy = new NotesServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('NotesServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('search → "notes:search" with query and limit', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const hits = [{ id: '1', title: 'Grocery List', snippet: 'milk, eggs' }];
    mockInvoke.mockResolvedValue(hits);
    const result = await proxy.search('milk', 5);
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'notes:search');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ query: 'milk', limit: 5 });
    expect(result).toEqual(hits);
  });

  it('list → "notes:list" with limit', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.list(10);
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'notes:list');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ limit: 10 });
  });

  it('get → "notes:get" with idOrTitle', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const note = {
      id: '1',
      title: 'Grocery List',
      body: 'milk, eggs',
      pinned: false,
      updatedAt: 1000,
    };
    mockInvoke.mockResolvedValue(note);
    const result = await proxy.get('Grocery List');
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'notes:get');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ idOrTitle: 'Grocery List' });
    expect(result).toEqual(note);
  });

  it('create → "notes:create" with title and body', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue({ id: '2', title: 'Idea' });
    const result = await proxy.create('Idea', 'build a launcher');
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'notes:create');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ title: 'Idea', body: 'build a launcher' });
    expect(result).toEqual({ id: '2', title: 'Idea' });
  });

  it('append → "notes:append" with idOrTitle and text', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue({ id: '1', title: 'Daily Log' });
    const result = await proxy.append('Daily Log', '10am: standup');
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'notes:append');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ idOrTitle: 'Daily Log', text: '10am: standup' });
    expect(result).toEqual({ id: '1', title: 'Daily Log' });
  });
});
