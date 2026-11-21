// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('./backupHandler.svelte', () => ({
  BackupHandler: class {
    providers = [];
    enabledCategories = new Set();
    localSummaries = new Map();
    exportPassword = '';
    exportStatus = 'idle';
    exportMessage = '';
    importModalOpen = false;
    importFile = '';
    importManifest = null;
    importPreviewData = new Map();
    importCategories = new Map();
    importNeedsPassword = false;
    importPassword = '';
    importStatus = 'idle';
    importMessage = '';
    exportCategories = [];
    hasSensitiveData = false;
    exportWillStripSensitive = false;
    canExport = false;
    canImport = false;
    async init() {}
  },
}));

import BackupTab from './BackupTab.svelte';
import type { SettingsHandler } from '../settingsHandlers.svelte';

describe('BackupTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits asyar:run-command to open the Raycast importer when Import from Raycast is clicked', async () => {
    const handler = { activeTab: 'backup' } as unknown as SettingsHandler;
    render(BackupTab, { props: { handler } });

    const btn = screen.getByRole('button', { name: /import from raycast/i });
    await fireEvent.click(btn);

    expect(emitMock).toHaveBeenCalledWith('asyar:run-command', {
      commandId: 'cmd_raycast-import_import-raycast',
    });
  });
});
