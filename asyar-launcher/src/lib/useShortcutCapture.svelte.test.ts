// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { useShortcutCapture } from './useShortcutCapture.svelte';
import { invoke } from '@tauri-apps/api/core';
import { VALID_KEYS } from '../built-in-features/shortcuts/shortcutFormatter';

function makeKeyEvent(type: 'keydown' | 'keyup', init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

describe('useShortcutCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Populate valid keys for tests
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
     'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
     '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Space', '/', 'Escape'].forEach(k => VALID_KEYS.add(k));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle', () => {
    const capture = useShortcutCapture({ onCapture: async () => true });
    expect(capture.state.isRecording).toBe(false);
    expect(capture.state.saveState).toBe('idle');
  });

  it('startRecording pauses OS shortcuts and flips isRecording', () => {
    const capture = useShortcutCapture({ onCapture: async () => true });
    capture.startRecording();
    expect(capture.state.isRecording).toBe(true);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('pause_all_shortcuts');
  });

  it('stopRecording resumes OS shortcuts', () => {
    const capture = useShortcutCapture({ onCapture: async () => true });
    capture.startRecording();
    vi.mocked(invoke).mockClear();
    capture.stopRecording();
    expect(capture.state.isRecording).toBe(false);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('resume_all_shortcuts');
  });

  it('Escape cancels recording and calls onCancel', () => {
    const onCancel = vi.fn();
    const capture = useShortcutCapture({ onCapture: async () => true, onCancel });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', { key: 'Escape' }));
    expect(capture.state.isRecording).toBe(false);
    expect(onCancel).toHaveBeenCalled();
  });

  it('pressing a letter without a modifier marks error no-modifier', () => {
    const capture = useShortcutCapture({ onCapture: async () => true });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', { key: 'a', code: 'KeyA' }));
    expect(capture.state.errorType).toBe('no-modifier');
    expect(capture.state.rejectedKeys).toContain('A');
  });

  it('Shift-only combination is rejected (no-modifier) to prevent accidental ? ! @ etc.', () => {
    const onCapture = vi.fn();
    const capture = useShortcutCapture({ onCapture: async () => true });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', { key: '?', code: 'Slash', shiftKey: true }));
    expect(capture.state.errorType).toBe('no-modifier');
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('pressing Backspace marks error invalid-key', () => {
    const capture = useShortcutCapture({ onCapture: async () => true });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', {
      key: 'Backspace',
      code: 'Backspace',
      metaKey: true,
    }));
    expect(capture.state.errorType).toBe('invalid-key');
  });

  it('Meta+K captures as Super+K via onCapture', async () => {
    const onCapture = vi.fn().mockResolvedValue(true);
    const capture = useShortcutCapture({ onCapture });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
    }));
    await vi.waitFor(() => {
      expect(onCapture).toHaveBeenCalledWith({ modifier: 'Super', key: 'K' });
    });
  });

  it('Shift+/ captures as Shift+/ (uses event.code, not the Shift-modified key)', async () => {
    const onCapture = vi.fn().mockResolvedValue(true);
    const capture = useShortcutCapture({ onCapture });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', {
      key: '?',
      code: 'Slash',
      shiftKey: true,
      metaKey: true,
    }));
    await vi.waitFor(() => {
      expect(onCapture).toHaveBeenCalledWith({ modifier: 'Shift+Super', key: '/' });
    });
  });

  it('canonical modifier order is Control, Alt, Shift, Super', async () => {
    const onCapture = vi.fn().mockResolvedValue(true);
    const capture = useShortcutCapture({ onCapture });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      metaKey: true,
    }));
    await vi.waitFor(() => {
      expect(onCapture).toHaveBeenCalledWith({ modifier: 'Control+Alt+Shift+Super', key: 'K' });
    });
  });

  it('onCapture returning an error string moves saveState to error', async () => {
    const capture = useShortcutCapture({ onCapture: async () => 'boom' });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
    }));
    await vi.waitFor(() => {
      expect(capture.state.saveState).toBe('error');
      expect(capture.state.errorMessage).toBe('boom');
    });
  });

  it('conflict checker truthy result sets errorType conflict', async () => {
    const conflictChecker = vi.fn().mockResolvedValue({ name: 'Slack' });
    const onCapture = vi.fn().mockResolvedValue(true);
    const capture = useShortcutCapture({ onCapture, conflictChecker });
    capture.startRecording();
    window.dispatchEvent(makeKeyEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
    }));
    await vi.waitFor(() => {
      expect(capture.state.errorType).toBe('conflict');
      expect(capture.state.conflictInfo).toBe('Slack');
    });
    expect(onCapture).not.toHaveBeenCalled();
  });
});
