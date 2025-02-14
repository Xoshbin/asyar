import { clipboard } from "./services/clipboard";
import { panel } from "./services/panel";
import { applications } from "./services/applications";
import { commands } from "./services/commands";
import { ui } from "./services/ui";
import { system } from "./services/system";
import { store } from "./services/store";

// Create a single API instance
const apiInstance = {
  clipboard,
  ui,
  system,
  store,
  panel,
  applications,
  commands,
} as const;

// Export the singleton instance
export const api = apiInstance;

// Export type for plugin usage
export type AsyarAPI = typeof apiInstance;

// Export individual services for direct usage in the app
export { clipboard, panel, applications, commands, ui, system, store };
