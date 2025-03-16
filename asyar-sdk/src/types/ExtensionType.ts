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
  resultType?: "inline" | "view"; // What kind of result this command produces
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

  /**
   * Performs a complex search operation.
   *
   * @remarks
   * The search method should be used with caution due to its potential impact on performance and resource consumption.
   * It's designed for search queries that cannot be implemented using the standard command registration system.
   * For typical search functionalities, please utilize the command registration mechanism for better efficiency.
   */
  search?: (query: string) => Promise<ExtensionResult[]>;

  onViewSearch?: (query: string) => Promise<void>;

  // Required command handling methods
  registerCommands: () => Promise<void>;
  executeCommand: (
    commandId: string,
    args?: Record<string, any>
  ) => Promise<any>;
}
