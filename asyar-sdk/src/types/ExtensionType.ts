import { ExtensionContext } from "../ExtensionContext";

export interface ExtensionManifest {
  name: string;
  id: string;
  version: string;
  description: string;
  type: "result" | "view";
  defaultView?: string;
  searchable?: boolean;
  commands: ExtensionCommand[];
}

export interface ExtensionCommand {
  name: string;
  description: string;
  trigger: string; // Text that triggers this command
  id: string; // Unique command identifier
}

export interface ExtensionResult {
  score: number;
  title: string;
  subtitle?: string;
  type: "result" | "view";
  action: () => void | Promise<void>;
  viewPath?: string;
}

// Extension interface only contains functionality methods, no metadata
export interface Extension {
  initialize(context: ExtensionContext): Promise<void>;
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  onUnload: any;

  // Optional backward compatibility method
  search?: (query: string) => Promise<ExtensionResult[]>;

  onViewSearch?: (query: string) => Promise<void>;

  // Required command handling methods
  registerCommands: () => Promise<void>;
  executeCommand: (
    commandId: string,
    args?: Record<string, any>
  ) => Promise<any>;
}
