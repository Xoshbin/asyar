import { clipboard } from "./services/clipboard";
import { panel } from "./services/panel";
import { applications } from "./services/applications";
import { commands } from "./services/commands";
import { ui } from "./services/ui";
import { system } from "./services/system";
import { store } from "./services/store";
import { log } from "./services/log";

// Export individual services for direct usage
export { clipboard, panel, applications, commands, ui, system, store, log };

// Export type for full API usage
export type AsyarAPI = {
  clipboard: typeof clipboard;
  panel: typeof panel;
  applications: typeof applications;
  commands: typeof commands;
  ui: typeof ui;
  system: typeof system;
  store: typeof store;
  log: typeof log;
};
