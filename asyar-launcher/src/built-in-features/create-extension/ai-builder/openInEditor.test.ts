import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn(() => ({ execute: mockExecute })));
const mockOpenPath = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: mockCreate } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: mockOpenPath }));

import { openInEditor } from './openInEditor';

beforeEach(() => { mockExecute.mockReset().mockResolvedValue(undefined); mockCreate.mockClear(); mockOpenPath.mockClear(); });

describe('openInEditor', () => {
  it('runs the editor command with cwd = path', async () => {
    await openInEditor('/home/u/AsyarExtensions/com.x.notion');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = (mockCreate.mock.calls[0] as any[])[2];
    expect(opts).toMatchObject({ cwd: '/home/u/AsyarExtensions/com.x.notion' });
    expect(mockExecute).toHaveBeenCalled();
    expect(mockOpenPath).not.toHaveBeenCalled();
  });

  it('falls back to openPath when the editor command throws', async () => {
    mockExecute.mockRejectedValueOnce(new Error('no code on PATH'));
    await openInEditor('/home/u/AsyarExtensions/com.x.notion');
    expect(mockOpenPath).toHaveBeenCalledWith('/home/u/AsyarExtensions/com.x.notion');
  });
});
