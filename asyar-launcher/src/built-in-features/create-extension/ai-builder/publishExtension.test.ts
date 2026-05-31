import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfirmAlert = vi.hoisted(() => vi.fn());
const mockOpenTerminal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { confirmAlert: mockConfirmAlert },
}));
vi.mock('./openTerminal', () => ({ openTerminalAt: mockOpenTerminal }));

import { publishExtension, PUBLISH_COMMAND } from './publishExtension';

beforeEach(() => {
  mockConfirmAlert.mockReset();
  mockOpenTerminal.mockClear();
});

describe('publishExtension', () => {
  it('opens a terminal with the publish command when confirmed', async () => {
    mockConfirmAlert.mockResolvedValue(true);
    await publishExtension('/home/u/AsyarExtensions/com.x.notion');
    expect(mockOpenTerminal).toHaveBeenCalledWith(
      '/home/u/AsyarExtensions/com.x.notion',
      PUBLISH_COMMAND
    );
  });

  it('does nothing when the user cancels the confirm', async () => {
    mockConfirmAlert.mockResolvedValue(false);
    await publishExtension('/home/u/AsyarExtensions/com.x.notion');
    expect(mockOpenTerminal).not.toHaveBeenCalled();
  });

  it('uses pnpm exec asyar publish as the command', () => {
    expect(PUBLISH_COMMAND).toBe('pnpm exec asyar publish');
  });
});
