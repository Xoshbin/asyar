import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let subscribers: Array<() => void> = [];
const developerState = { verboseLogging: false };
const mockLogService = vi.hoisted(() => ({ setVerboseLogging: vi.fn() }));

vi.mock('../settings/settingsService.svelte', () => ({
  settingsService: {
    subscribe(callback: () => void) {
      subscribers.push(callback);
      return () => {
        subscribers = subscribers.filter((candidate) => candidate !== callback);
      };
    },
  },
}));

vi.mock('../settings/developerSettingsService.svelte', () => ({
  developerSettingsService: {
    get verboseLogging() {
      return developerState.verboseLogging;
    },
  },
}));

vi.mock('./logService', () => ({
  logService: mockLogService,
}));

import {
  __resetVerboseLoggingSyncForTest,
  initVerboseLoggingSync,
} from './verboseLoggingSync.svelte';

describe('verboseLoggingSync', () => {
  beforeEach(() => {
    subscribers = [];
    developerState.verboseLogging = false;
    mockLogService.setVerboseLogging.mockClear();
    __resetVerboseLoggingSyncForTest();
  });

  afterEach(() => {
    __resetVerboseLoggingSyncForTest();
  });

  it('pushes the effective developer verbose setting on init', () => {
    developerState.verboseLogging = true;

    initVerboseLoggingSync();

    expect(mockLogService.setVerboseLogging).toHaveBeenCalledOnce();
    expect(mockLogService.setVerboseLogging).toHaveBeenCalledWith(true);
  });

  it('keeps the logger synchronized with settings changes', () => {
    initVerboseLoggingSync();
    developerState.verboseLogging = true;

    subscribers.forEach((callback) => callback());

    expect(mockLogService.setVerboseLogging).toHaveBeenNthCalledWith(1, false);
    expect(mockLogService.setVerboseLogging).toHaveBeenNthCalledWith(2, true);
  });

  it('replaces the previous subscription when initialized again', () => {
    initVerboseLoggingSync();
    initVerboseLoggingSync();

    expect(subscribers).toHaveLength(1);
  });
});
