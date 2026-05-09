import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./scriptsManager.svelte', () => ({
  scriptsManager: {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
}));

vi.mock('./dispatch', () => ({
  dispatchScriptCommand: vi.fn(async () => {}),
}));

vi.mock('./ScriptsManagerView.svelte', () => ({ default: {} }));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: { navigateToView: vi.fn() },
}));

import ScriptsExtension from './index';
import { scriptsManager } from './scriptsManager.svelte';
import { dispatchScriptCommand } from './dispatch';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ScriptsExtension', () => {
  it('activate_starts_scripts_manager', async () => {
    await ScriptsExtension.activate();

    expect(scriptsManager.start).toHaveBeenCalled();
  });

  it('deactivate_stops_scripts_manager', async () => {
    await ScriptsExtension.deactivate();

    expect(scriptsManager.stop).toHaveBeenCalled();
  });

  it('executeCommand_for_dynamic_id_dispatches_via_dispatch_handler', async () => {
    const args = { arguments: { x: 1 } };
    await ScriptsExtension.executeCommand('some-dynamic-id', args);

    expect(dispatchScriptCommand).toHaveBeenCalledWith('some-dynamic-id', args);
  });
});
