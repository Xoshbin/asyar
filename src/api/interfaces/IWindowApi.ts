/**
 * Interface for Window API operations
 */
export interface IWindowApi {
  /**
   * Hide the application window
   */
  hide(): Promise<void>;

  /**
   * Show the application window
   */
  show(): Promise<void>;
}
