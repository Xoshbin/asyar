import type { AsyarAPI } from "../api";
import { SearchResultItem } from "./searchResultItem";

export interface Extension {
  manifest: ExtensionManifest;
  api?: AsyarAPI; // Will be injected by Extension loader
  initialize?: (config?: Record<string, any>) => Promise<void>;
  onUnload?: () => Promise<void>;
  getView?: (viewName: string) => Promise<React.ComponentType<any>>;
  registerCommands?: () => Promise<void>;
  getSearchResults?: (query: string) => SearchResultItem[];
  registerViews?: () => Promise<void>;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry_point: string;
  commands: ExtensionCommand[];
  views?: ExtensionView[];
  permissions?: string[];
  configuration?: Record<string, any>;
}

export interface ExtensionCommand {
  name: string;
  description: string;
  handler: string;
}

export interface ExtensionView {
  name: string;
  component: string;
}
