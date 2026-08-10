import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  getLauncherPlacement: vi.fn(),
  setLauncherPlacement: vi.fn().mockResolvedValue(undefined),
}));

import { LauncherPlacementService, DEFAULT_PLACEMENT } from './launcherPlacementService.svelte';
import { getLauncherPlacement, setLauncherPlacement } from '../../lib/ipc/commands';

describe('LauncherPlacementService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts on the default placement before anything is loaded', () => {
    const svc = new LauncherPlacementService();
    expect(svc.placement).toEqual(DEFAULT_PLACEMENT);
    expect(svc.loaded).toBe(false);
  });

  it('loads the persisted placement', async () => {
    vi.mocked(getLauncherPlacement).mockResolvedValueOnce({
      monitor: 'primary',
      anchor: { kind: 'centered' },
      snapEnabled: true,
    });
    const svc = new LauncherPlacementService();
    await svc.load();

    expect(svc.placement).toEqual({
      monitor: 'primary',
      anchor: { kind: 'centered' },
      snapEnabled: true,
    });
    expect(svc.loaded).toBe(true);
  });

  it('falls back to the default when the command returns nothing', async () => {
    vi.mocked(getLauncherPlacement).mockResolvedValueOnce(null);
    const svc = new LauncherPlacementService();
    await svc.load();

    expect(svc.placement).toEqual(DEFAULT_PLACEMENT);
    expect(svc.loaded).toBe(true);
  });

  it('persists a monitor change without touching the anchor', async () => {
    const svc = new LauncherPlacementService();
    await svc.setMonitor('primary');

    expect(setLauncherPlacement).toHaveBeenCalledWith({
      monitor: 'primary',
      anchor: DEFAULT_PLACEMENT.anchor,
      snapEnabled: true,
    });
    expect(svc.placement.monitor).toBe('primary');
  });

  it('persists a vertical preset without touching the monitor', async () => {
    vi.mocked(getLauncherPlacement).mockResolvedValueOnce({
      monitor: 'primary',
      anchor: { kind: 'free', x: 0.1, y: 0.9 },
      snapEnabled: true,
    });
    const svc = new LauncherPlacementService();
    await svc.load();
    await svc.setVertical('center');

    expect(setLauncherPlacement).toHaveBeenCalledWith({
      monitor: 'primary',
      anchor: { kind: 'centered' },
      snapEnabled: true,
    });
  });

  it('carries the current bias into custom mode so the slider does not jump', async () => {
    const svc = new LauncherPlacementService();
    await svc.setVertical('custom');

    expect(setLauncherPlacement).toHaveBeenCalledWith({
      monitor: 'cursor',
      anchor: { kind: 'topWeighted', bias: 0.16 },
      snapEnabled: true,
    });
  });

  it('converts the slider percentage to a fraction', async () => {
    const svc = new LauncherPlacementService();
    await svc.setBias(42);

    expect(setLauncherPlacement).toHaveBeenCalledWith({
      monitor: 'cursor',
      anchor: { kind: 'topWeighted', bias: 0.42 },
      snapEnabled: true,
    });
  });

  it('persists a snap-enabled change without touching monitor or anchor', async () => {
    const svc = new LauncherPlacementService();
    await svc.setSnapEnabled(false);

    expect(setLauncherPlacement).toHaveBeenCalledWith({
      monitor: DEFAULT_PLACEMENT.monitor,
      anchor: DEFAULT_PLACEMENT.anchor,
      snapEnabled: false,
    });
    expect(svc.placement.snapEnabled).toBe(false);
  });

  describe('vertical (the segmented control selection)', () => {
    it('reports top for the default bias', () => {
      expect(new LauncherPlacementService().vertical).toBe('top');
    });

    it('reports custom for any other bias', async () => {
      vi.mocked(getLauncherPlacement).mockResolvedValueOnce({
        monitor: 'cursor',
        anchor: { kind: 'topWeighted', bias: 0.5 },
        snapEnabled: true,
      });
      const svc = new LauncherPlacementService();
      await svc.load();
      expect(svc.vertical).toBe('custom');
    });

    it('reports null for a dragged position, so no segment looks selected', async () => {
      vi.mocked(getLauncherPlacement).mockResolvedValueOnce({
        monitor: 'cursor',
        anchor: { kind: 'free', x: 0.3, y: 0.4 },
        snapEnabled: true,
      });
      const svc = new LauncherPlacementService();
      await svc.load();

      expect(svc.vertical).toBeNull();
      expect(svc.isDragged).toBe(true);
    });
  });

  it('reset returns the whole placement to the default', async () => {
    vi.mocked(getLauncherPlacement).mockResolvedValueOnce({
      monitor: 'primary',
      anchor: { kind: 'free', x: 0.3, y: 0.4 },
      snapEnabled: true,
    });
    const svc = new LauncherPlacementService();
    await svc.load();
    await svc.reset();

    expect(setLauncherPlacement).toHaveBeenCalledWith(DEFAULT_PLACEMENT);
    expect(svc.isDragged).toBe(false);
  });

  it('keeps the previous value when a save fails', async () => {
    vi.mocked(setLauncherPlacement).mockRejectedValueOnce(new Error('disk full'));
    const svc = new LauncherPlacementService();

    await expect(svc.setMonitor('primary')).rejects.toThrow('disk full');
    expect(svc.placement).toEqual(DEFAULT_PLACEMENT);
  });
});
