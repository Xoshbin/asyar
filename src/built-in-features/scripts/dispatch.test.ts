import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/shell/shellService.svelte', () => ({
  shellService: { spawn: vi.fn(async () => ({ streaming: true })) },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn(async () => {}) },
}));

vi.mock('./scriptsManager.svelte', () => ({
  scriptsManager: {
    getScriptByDynamicId: vi.fn(),
  },
}));

import { dispatchScriptCommand } from './dispatch';
import { shellService } from '../../services/shell/shellService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { scriptsManager } from './scriptsManager.svelte';
import type { ScannedScript } from './types';

const mockScript: ScannedScript = {
  absolutePath: '/foo/bar.sh',
  dynamicId: 'dyn123',
  header: {
    title: 'My Script',
    icon: null,
    arguments: [],
  },
  executable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dispatchScriptCommand', () => {
  it('dispatch_with_known_id_calls_shell_spawn', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(mockScript);

    await dispatchScriptCommand('dyn123', undefined);

    expect(shellService.spawn).toHaveBeenCalledWith(
      'scripts',
      '/foo/bar.sh',
      [],
      expect.any(String),
    );
    expect(diagnosticsService.report).not.toHaveBeenCalled();
  });

  it('dispatch_with_unknown_id_reports_diagnostic', async () => {
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(undefined);

    await dispatchScriptCommand('ghost', undefined);

    expect(diagnosticsService.report).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'action_failed' }),
    );
    expect(shellService.spawn).not.toHaveBeenCalled();
  });

  it('dispatch_with_args_passes_them_in_declared_order', async () => {
    const scriptWithArgs: ScannedScript = {
      ...mockScript,
      header: {
        ...mockScript.header,
        arguments: [
          { name: 'name', type: 'text', placeholder: undefined, required: false },
          { name: 'count', type: 'text', placeholder: undefined, required: false },
        ],
      },
    };
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(scriptWithArgs);

    await dispatchScriptCommand('dyn123', { name: 'alice', count: 3 });

    expect(shellService.spawn).toHaveBeenCalledWith(
      'scripts',
      '/foo/bar.sh',
      ['alice', '3'],
      expect.any(String),
    );
  });

  it('dispatch_resolves_args_under_arguments_key_envelope', async () => {
    const scriptWithArgs: ScannedScript = {
      ...mockScript,
      header: {
        ...mockScript.header,
        arguments: [
          { name: 'name', type: 'text', placeholder: undefined, required: false },
          { name: 'count', type: 'text', placeholder: undefined, required: false },
        ],
      },
    };
    vi.mocked(scriptsManager.getScriptByDynamicId).mockReturnValue(scriptWithArgs);

    await dispatchScriptCommand('dyn123', { arguments: { name: 'alice', count: 3 } } as any);

    expect(shellService.spawn).toHaveBeenCalledWith(
      'scripts',
      '/foo/bar.sh',
      ['alice', '3'],
      expect.any(String),
    );
  });
});
