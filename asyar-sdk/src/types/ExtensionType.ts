import { ExtensionContext } from "../ExtensionContext";

export interface ExtensionManifest {
  name: string;
  id: string;
  version: string;
  description: string;
  type: "result" | "view";
  defaultView?: string;
  searchable?: boolean; // Add this property
  commands: ExtensionCommand[];
}

export interface ExtensionCommand {
  name: string;
  description: string;
  trigger: string; // Text that triggers this command
}

export interface ExtensionResult {
  score: number;
  title: string;
  subtitle?: string;
  type: "result" | "view";
  action: () => void | Promise<void>;
  viewPath?: string;
}

export interface SearchProvider {
  getAll(): Promise<any[]>;
}

export interface Extension {
  id: string;
  name: string;
  version: string;
  initialize(context: ExtensionContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  onUnload: any;
  search: (query: string) => Promise<ExtensionResult[]>;
  onViewSearch?: (query: string) => Promise<void>;
  searchProviders?: SearchProvider[];
}
