import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  raycastImportParse: vi.fn(),
}));
vi.mock('./importApplier', () => ({
  applyBundle: vi.fn(),
}));

import { RaycastImportState } from './raycastImportState.svelte';
import { raycastImportParse } from '../../lib/ipc/commands';
import { applyBundle } from './importApplier';
import type { ImportBundle } from './types';

const BUNDLE: ImportBundle = {
  source: 'rayconfigX',
  snippets: [{ name: 'S', expansion: 'x', pinned: false }],
  portals: [],
  shortcuts: [],
  skipped: { hotkeys: 2, aliases: 1 },
};

describe('RaycastImportState', () => {
  let state: RaycastImportState;

  beforeEach(() => {
    vi.clearAllMocks();
    state = new RaycastImportState();
  });

  it('starts in the pick phase', () => {
    expect(state.phase).toBe('pick');
  });

  it('moves to preview when the file parses without a password', async () => {
    vi.mocked(raycastImportParse).mockResolvedValue({ status: 'ok', bundle: BUNDLE });

    await state.chooseFile('/tmp/export.rayconfig');

    expect(raycastImportParse).toHaveBeenCalledWith('/tmp/export.rayconfig', undefined);
    expect(state.phase).toBe('preview');
    expect(state.bundle).toEqual(BUNDLE);
  });

  it('asks for a password when the file is encrypted', async () => {
    vi.mocked(raycastImportParse).mockResolvedValue({ status: 'passwordRequired' });

    await state.chooseFile('/tmp/export.rayconfig');

    expect(state.phase).toBe('password');
    expect(state.passwordError).toBe(false);
  });

  it('flags a wrong password and stays in the password phase', async () => {
    vi.mocked(raycastImportParse).mockResolvedValue({ status: 'passwordRequired' });
    await state.chooseFile('/tmp/export.rayconfig');

    vi.mocked(raycastImportParse).mockResolvedValue({ status: 'wrongPassword' });
    state.password = 'bad';
    await state.submitPassword();

    expect(raycastImportParse).toHaveBeenLastCalledWith('/tmp/export.rayconfig', 'bad');
    expect(state.phase).toBe('password');
    expect(state.passwordError).toBe(true);
  });

  it('returns to pick when parsing fails outright', async () => {
    vi.mocked(raycastImportParse).mockResolvedValue(null);

    await state.chooseFile('/tmp/garbage.bin');

    expect(state.phase).toBe('pick');
    expect(state.bundle).toBeNull();
  });

  it('imports the selected categories and reports a summary', async () => {
    vi.mocked(raycastImportParse).mockResolvedValue({ status: 'ok', bundle: BUNDLE });
    const summary = {
      snippets: { added: 1, skipped: 0 },
      portals: { added: 0, skipped: 0 },
      shortcuts: { added: 0, skipped: 0 },
    };
    vi.mocked(applyBundle).mockResolvedValue(summary);

    await state.chooseFile('/tmp/export.rayconfig');
    state.selection.portals = false;
    await state.runImport();

    expect(applyBundle).toHaveBeenCalledWith(BUNDLE, {
      snippets: true,
      portals: false,
      shortcuts: true,
    });
    expect(state.phase).toBe('done');
    expect(state.summary).toEqual(summary);
  });

  it('reset returns everything to the initial state', async () => {
    vi.mocked(raycastImportParse).mockResolvedValue({ status: 'ok', bundle: BUNDLE });
    await state.chooseFile('/tmp/export.rayconfig');

    state.reset();

    expect(state.phase).toBe('pick');
    expect(state.bundle).toBeNull();
    expect(state.filePath).toBeNull();
    expect(state.password).toBe('');
    expect(state.summary).toBeNull();
  });
});
