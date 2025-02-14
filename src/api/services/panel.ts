import { invoke } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";

export const panel = {
  async show(): Promise<void> {
    info("[Panel API] Showing panel");
    await invoke("show");
  },

  async hide(): Promise<void> {
    info("[Panel API] Hiding panel");
    await invoke("hide");
  },

  async toggle(): Promise<void> {
    info("[Panel API] Toggling panel");
    await invoke("toggle_panel");
  },
} as const;
