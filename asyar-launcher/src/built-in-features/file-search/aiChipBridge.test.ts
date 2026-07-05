import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn() }));
vi.mock('../../services/context/contextModeService.svelte', () => ({
  contextModeService: { activate: vi.fn() },
}));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../services/extension/extensionManager.svelte', () => ({
  default: { goBack: vi.fn() },
}));

import { readFile } from '@tauri-apps/plugin-fs';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import extensionManager from '../../services/extension/extensionManager.svelte';
import { primeAiChipForFile } from './aiChipBridge';

function hit(overrides: Partial<any> = {}): any {
  return {
    fileId: 'a',
    name: 'report.txt',
    path: '/r/report.txt',
    type: 'document',
    isDir: false,
    modifiedAt: 0,
    score: 1,
    pinned: false,
    source: 'local',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('primeAiChipForFile', () => {
  it('navigates back and activates the AI agent with the file path', async () => {
    await primeAiChipForFile(hit({ type: 'folder' }));
    expect(extensionManager.goBack).toHaveBeenCalled();
    expect(contextModeService.activate).toHaveBeenCalledWith(
      'agents:default',
      expect.stringContaining('/r/report.txt'),
    );
  });

  it('inlines file contents for text types under the size cap', async () => {
    vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode('hello world'));
    await primeAiChipForFile(hit({ type: 'document' }));
    const body = vi.mocked(contextModeService.activate).mock.calls[0][1] as string;
    expect(body).toContain('hello world');
  });

  it('inlines contents for code files too', async () => {
    vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode('const x = 1;'));
    await primeAiChipForFile(hit({ type: 'code', path: '/r/a.ts' }));
    const body = vi.mocked(contextModeService.activate).mock.calls[0][1] as string;
    expect(body).toContain('const x = 1;');
  });

  it('does not read file contents for non-text types', async () => {
    await primeAiChipForFile(hit({ type: 'image' }));
    expect(readFile).not.toHaveBeenCalled();
  });

  it('gracefully continues without contents when readFile fails', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('boom'));
    await primeAiChipForFile(hit({ type: 'document' }));
    expect(contextModeService.activate).toHaveBeenCalled();
  });
});
