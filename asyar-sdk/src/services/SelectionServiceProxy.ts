import { BaseServiceProxy } from './BaseServiceProxy'
import { ISelectionService } from './ISelectionService'

/**
 * Proxy for the Selection service, mapping SDK calls to IPC commands.
 */
export class SelectionServiceProxy extends BaseServiceProxy implements ISelectionService {
  getSelectedText(): Promise<string | null> {
    return this.broker.invoke<string | null>(
      'selection:getSelectedText', {}, undefined, 5000);
  }

  getSelectedFinderItems(): Promise<string[]> {
    return this.broker.invoke<string[]>(
      'selection:getSelectedFinderItems', {}, undefined, 5000);
  }
}
