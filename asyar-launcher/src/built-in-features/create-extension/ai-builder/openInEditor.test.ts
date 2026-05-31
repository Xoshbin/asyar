import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn(() => ({ execute: mockExecute })));
const mockOpenPath = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPlatform = vi.hoisted(() => vi.fn(() => 'macos'));
const mockReport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: mockCreate } }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: mockOpenPath }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: mockPlatform }));
vi.mock('../../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: mockReport },
}));

import { openInEditor } from './openInEditor';

beforeEach(() => {
  mockExecute.mockReset().mockResolvedValue(undefined);
  mockCreate.mockClear();
  mockOpenPath.mockReset().mockResolvedValue(undefined);
  mockPlatform.mockReset().mockReturnValue('macos');
  mockReport.mockClear();
});

describe('openInEditor', () => {
  it('runs `code` with cwd = path on non-Windows platforms', async () => {
    mockPlatform.mockReturnValue('macos');
    await openInEditor('/home/u/AsyarExtensions/com.x.notion');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockCreate.mock.calls[0] as any[])[0]).toBe('code');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = (mockCreate.mock.calls[0] as any[])[2];
    expect(opts).toMatchObject({ cwd: '/home/u/AsyarExtensions/com.x.notion' });
    expect(mockExecute).toHaveBeenCalled();
    expect(mockOpenPath).not.toHaveBeenCalled();
  });

  it('runs `code-cmd` on Windows', async () => {
    mockPlatform.mockReturnValue('windows');
    await openInEditor('C:/Users/u/AsyarExtensions/com.x.notion');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockCreate.mock.calls[0] as any[])[0]).toBe('code-cmd');
  });

  it('falls back to openPath when the editor command throws', async () => {
    mockExecute.mockRejectedValueOnce(new Error('no code on PATH'));
    await openInEditor('/home/u/AsyarExtensions/com.x.notion');
    expect(mockOpenPath).toHaveBeenCalledWith('/home/u/AsyarExtensions/com.x.notion');
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('reports a manual diagnostic when both the editor and openPath throw', async () => {
    mockExecute.mockRejectedValueOnce(new Error('no code'));
    mockOpenPath.mockRejectedValueOnce(new Error('no opener'));
    await openInEditor('/home/u/AsyarExtensions/com.x.notion');
    expect(mockReport).toHaveBeenCalledWith({
      source: 'frontend',
      kind: 'manual',
      severity: 'info',
      retryable: false,
      context: {
        message:
          "Couldn't open the editor. Open the folder manually: /home/u/AsyarExtensions/com.x.notion",
      },
    });
  });
});
