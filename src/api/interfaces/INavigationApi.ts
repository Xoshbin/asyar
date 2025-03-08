/**
 * Interface for Navigation API
 */
export interface INavigationApi {
  /**
   * Navigate to a specific extension view
   */
  navigateToView(viewPath: string, viewName: string): void;

  /**
   * Close the current view and return to main screen
   */
  closeView(): void;
}
