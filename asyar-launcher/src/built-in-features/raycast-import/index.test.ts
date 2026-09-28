import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./raycastImportState.svelte', () => ({
  raycastImportState: {
    reset: vi.fn(),
  },
}));

vi.mock('./DefaultView.svelte', () => ({ default: {} }));

import raycastImportExtension from './index';
import { raycastImportState } from './raycastImportState.svelte';

describe('RaycastImportExtension', () => {
  let mockExtensionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtensionManager = {
      navigateToView: vi.fn(),
    };
  });

  it('navigates to DefaultView and resets state on import-raycast command', async () => {
    await raycastImportExtension.initialize({
      getService: () => mockExtensionManager,
      preferences: { values: {} },
    } as any);

    const res = await raycastImportExtension.executeCommand('import-raycast');
    expect(res).toEqual({ type: 'view', viewPath: 'raycast-import/DefaultView' });
    expect(raycastImportState.reset).toHaveBeenCalled();
    expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('raycast-import/DefaultView');
  });

  it('throws on unknown commands', async () => {
    await expect(raycastImportExtension.executeCommand('unknown')).rejects.toThrow(
      'Unknown command: unknown',
    );
  });

  it('resets state on activate and deactivate', async () => {
    await raycastImportExtension.activate();
    expect(raycastImportState.reset).toHaveBeenCalledTimes(1);

    await raycastImportExtension.deactivate();
    expect(raycastImportState.reset).toHaveBeenCalledTimes(2);
  });
});
