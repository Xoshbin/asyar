import { invoke } from "@tauri-apps/api/core";
import { log } from "./log";

export const panel = {
  async show(): Promise<void> {
    log.info("[Panel API] Showing panel");
    await invoke("show");
  },

  async hide(): Promise<void> {
    log.info("[Panel API] Hiding panel");
    await invoke("hide");
  },

  async toggle(): Promise<void> {
    log.info("[Panel API] Toggling panel");
    await invoke("toggle_panel");
  },
} as const;
