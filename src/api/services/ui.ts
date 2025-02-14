import { info } from "@tauri-apps/plugin-log";
import type { ViewTransitionAction } from "../../types";

export const ui = {
  async showView(extensionId: string, viewName: string): Promise<void> {
    info(`[UI API] Showing view: ${extensionId}/${viewName}`);
    return;
  },

  async hidePanel(): Promise<void> {
    info("[UI API] Hiding panel");
    // Implementation will be injected
  },

  createViewTransition(
    extensionId: string,
    viewName: string
  ): ViewTransitionAction {
    return {
      type: "SET_VIEW",
      view: "extension",
      extensionId,
      viewName,
    };
  },
} as const;
