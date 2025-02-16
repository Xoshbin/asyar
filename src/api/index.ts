import { clipboardApi } from "./services/clipboardApi";
import { panel } from "./services/panel";
import { applications } from "./services/applications";
import { commands } from "./services/commands";
import { ui } from "./services/ui";
import { system } from "./services/system";
import { store } from "./services/store";
import { log } from "./services/log";
import { keyboardNavigation } from "./services/keyboardNavigation";
import type { ClipboardItem } from "../types/clipboardItem";

// Export individual services for direct usage
export {
  clipboardApi,
  panel,
  applications,
  commands,
  ui,
  system,
  store,
  log,
  keyboardNavigation,
  ClipboardItem,
};

// Export type for full API usage
export type AsyarAPI = {
  clipboardApi: typeof clipboardApi;
  panel: typeof panel;
  applications: typeof applications;
  commands: typeof commands;
  ui: typeof ui;
  system: typeof system;
  store: typeof store;
  log: typeof log;
  keyboardNavigation: typeof keyboardNavigation;
  ClipboardItem: typeof ClipboardItem;
};
