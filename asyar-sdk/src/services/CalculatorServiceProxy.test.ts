import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
  },
}));

import { CalculatorServiceProxy } from './CalculatorServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('CalculatorServiceProxy', () => {
  let proxy: CalculatorServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new CalculatorServiceProxy();
  });

  it('evaluate invokes calculator:evaluate with query and returns results', async () => {
    const sample = [{ value: '42', detail: '6 * 7', kind: 'math' as const }];
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(sample);

    const result = await proxy.evaluate('6 * 7');

    expect(mockBroker.invoke).toHaveBeenCalledWith('calculator:evaluate', { query: '6 * 7' });
    expect(result).toEqual(sample);
  });

  it('evaluate resolves to null when query is not an expression', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(null);

    const result = await proxy.evaluate('random text');

    expect(mockBroker.invoke).toHaveBeenCalledWith('calculator:evaluate', { query: 'random text' });
    expect(result).toBeNull();
  });

  it('evaluate propagates broker errors', async () => {
    vi.mocked(mockBroker.invoke).mockRejectedValueOnce(new Error('permission denied'));

    await expect(proxy.evaluate('6 * 7')).rejects.toThrow('permission denied');
  });
});
