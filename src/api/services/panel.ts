import { log } from "./log";
import panelManager from "../../services/panelManager";

export const panel = {
  async show(): Promise<void> {
    log.info("[Panel API] Showing panel");
    await panelManager.show();
  },

  async hide(): Promise<void> {
    log.info("[Panel API] Hiding panel");
    await panelManager.hide();
  },

  async toggle(): Promise<void> {
    log.info("[Panel API] Toggling panel");
    await panelManager.toggle();
  },
} as const;
