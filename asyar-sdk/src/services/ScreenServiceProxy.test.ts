import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
  },
}));

import { ScreenServiceProxy } from './ScreenServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('ScreenServiceProxy', () => {
  let proxy: ScreenServiceProxy;
  let mockBroker: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBroker = messageBroker;
    proxy = new ScreenServiceProxy();
  });

  it('pickColor invokes screen:pickColor and returns the color', async () => {
    const sample = { r: 26, g: 43, b: 60, hex: '#1a2b3c' };
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(sample);

    const color = await proxy.pickColor();

    expect(mockBroker.invoke).toHaveBeenCalledWith('screen:pickColor', {});
    expect(color).toEqual(sample);
  });

  it('pickColor resolves to null when the user cancels', async () => {
    vi.mocked(mockBroker.invoke).mockResolvedValueOnce(null);

    const color = await proxy.pickColor();

    expect(color).toBeNull();
  });

  it('pickColor propagates broker errors', async () => {
    vi.mocked(mockBroker.invoke).mockRejectedValueOnce(new Error('permission denied'));

    await expect(proxy.pickColor()).rejects.toThrow('permission denied');
  });
});
