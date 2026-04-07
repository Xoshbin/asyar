import { invoke } from '@tauri-apps/api/core';
import type { ISelectionService, SelectionError, SelectionErrorCode } from 'asyar-sdk';

export class SelectionService implements ISelectionService {
  /**
   * Returns selected text or null if nothing is selected.
   * Host service bridging to the Rust 'get_selected_text' command.
   */
  async getSelectedText(): Promise<string | null> {
    try {
      console.log('[SelectionService] Invoking get_selected_text...');
      const result = await invoke<string | null>('get_selected_text');
      return result;
    } catch (error: any) {
      this.throwSelectionError(error);
      throw error; // unreachable due to throwSelectionError
    }
  }

  /**
   * Returns absolute paths of selected file-manager items, or [] if none.
   * Host service bridging to the Rust 'get_selected_finder_items' command.
   */
  async getSelectedFinderItems(): Promise<string[]> {
    try {
      console.log('[SelectionService] Invoking get_selected_finder_items...');
      const result = await invoke<string[]>('get_selected_finder_items');
      return result || [];
    } catch (error: any) {
      this.throwSelectionError(error);
      throw error; // unreachable due to throwSelectionError
    }
  }

  private throwSelectionError(error: any): never {
    const errorString = String(error);
    let code: SelectionErrorCode = 'OPERATION_FAILED';

    if (errorString.includes('ACCESSIBILITY_PERMISSION_REQUIRED')) {
      code = 'ACCESSIBILITY_PERMISSION_REQUIRED';
    } else if (errorString.includes('ACCESSIBILITY_UNAVAILABLE')) {
      code = 'ACCESSIBILITY_UNAVAILABLE';
    } else if (errorString.includes('CLIPBOARD_RESTORE_FAILED')) {
      code = 'CLIPBOARD_RESTORE_FAILED';
    } else if (errorString.includes('OPERATION_FAILED')) {
      code = 'OPERATION_FAILED';
    }

    const selectionError = new Error(errorString) as SelectionError;
    selectionError.code = code;
    
    console.error(`[SelectionService] ${code}: ${errorString}`);
    throw selectionError;
  }
}

export const selectionService = new SelectionService();
