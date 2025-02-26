import extensionManager from "../services/extensionManager";

export class NavigationApi {
  static setView(extensionId: string, viewName: string) {
    return extensionManager.navigateToView(`${extensionId}/${viewName}`);
  }
}
