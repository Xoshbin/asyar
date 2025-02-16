import { clipboardApi } from "./services/clipboardApi";
import { panel } from "./services/panel";
import { applications } from "./services/applications";
import { commands } from "./services/commands";
import { ui } from "./services/ui";
import { store } from "./services/store";
import { log } from "./services/log";
import type { ResultCategory, ClipboardItem } from "../types";

// Export individual services for direct usage
export {
  clipboardApi,
  panel,
  applications,
  commands,
  ui,
  store,
  log,
  ClipboardItem,
  ResultCategory,
};

// Export type for full API usage
export type AsyarAPI = {
  clipboardApi: typeof clipboardApi;
  panel: typeof panel;
  applications: typeof applications;
  commands: typeof commands;
  ui: typeof ui;
  store: typeof store;
  log: typeof log;
  ClipboardItem: typeof ClipboardItem;
};
