import extensionManager from "../services/extensionManager";
import type { INavigationApi } from "./interfaces/INavigationApi";

/**
 * API for navigation operations
 */
export class NavigationApi implements INavigationApi {
  /**
   * Navigate to a specific extension view
   */
  navigateToView(extensionId: string, viewName: string) {
    return extensionManager.navigateToView(`${extensionId}/${viewName}`);
  }

  /**
   * Close the current view and return to main screen
   */
  closeView(): void {
    extensionManager.closeView();
  }
}
