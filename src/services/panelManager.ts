import { invoke } from "@tauri-apps/api/core";

class PanelManager {
  async show(): Promise<void> {
    await invoke("show");
  }

  async hide(): Promise<void> {
    await invoke("hide");
  }

  async toggle(): Promise<void> {
    // Toggle panel visibility
    await invoke("toggle_panel");
  }
}

export default new PanelManager();
