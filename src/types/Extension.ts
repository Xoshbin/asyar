import { ActionResult, ResultCategory } from ".";
import type { AsyarAPI } from "../api";

export interface SearchResultItem {
  id: string;
  title: string;
  subtitle?: string;
  category: ResultCategory;
  icon?: string;
  action: () => Promise<ActionResult>;
  score: number; // For ranking results
  metadata?: Record<string, any>;
}

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
