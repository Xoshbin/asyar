import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SelectionService } from './selectionService';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock logService to avoid Tauri plugin-log calls in tests
vi.mock('../log/logService', () => ({
  logService: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('SelectionService', () => {
  let service: SelectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SelectionService();
  });

  describe('getSelectedText', () => {
    it('should call tauri get_selected_text command', async () => {
      vi.mocked(invoke).mockResolvedValue('Hello World');

      const result = await service.getSelectedText();

      expect(invoke).toHaveBeenCalledWith('get_selected_text');
      expect(result).toBe('Hello World');
    });

    it('should throw SelectionError if a11y permission is missing', async () => {
      const error = 'ACCESSIBILITY_PERMISSION_REQUIRED';
      vi.mocked(invoke).mockRejectedValue(error);

      await expect(service.getSelectedText()).rejects.toMatchObject({
        code: 'ACCESSIBILITY_PERMISSION_REQUIRED'
      });
    });
  });

  describe('getSelectedFinderItems', () => {
    it('should call tauri get_selected_finder_items command', async () => {
      const items = ['/Users/test/file.txt'];
      vi.mocked(invoke).mockResolvedValue(items);

      const result = await service.getSelectedFinderItems();

      expect(invoke).toHaveBeenCalledWith('get_selected_finder_items');
      expect(result).toEqual(items);
    });

    it('should throw SelectionError on generic operation failure', async () => {
      const error = 'OPERATION_FAILED: something went wrong';
      vi.mocked(invoke).mockRejectedValue(error);

      await expect(service.getSelectedFinderItems()).rejects.toMatchObject({
        code: 'OPERATION_FAILED'
      });
    });
  });
});
