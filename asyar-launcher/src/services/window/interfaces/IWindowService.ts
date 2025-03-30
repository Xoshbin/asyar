/**
 * Interface for the WindowService
 */

export interface IWindowService {
  hide(): Promise<void>;
  show(): Promise<void>;
}
