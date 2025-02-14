import { info } from "@tauri-apps/plugin-log";
import type { ViewTransitionAction } from "../../types";

export const ui = {
  async showView(pluginId: string, viewName: string): Promise<void> {
    info(`[UI API] Showing view: ${pluginId}/${viewName}`);
    return;
  },

  async hidePanel(): Promise<void> {
    info("[UI API] Hiding panel");
    // Implementation will be injected
  },

  createViewTransition(
    pluginId: string,
    viewName: string
  ): ViewTransitionAction {
    return {
      type: "SET_VIEW",
      view: "plugin",
      pluginId,
      viewName,
    };
  },
} as const;
