export interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  type: "result" | "view";
  commands: ExtensionCommand[];
}

export interface ExtensionCommand {
  name: string;
  description: string;
  trigger: string; // Text that triggers this command
}

export interface ExtensionResult {
  title: string;
  subtitle?: string;
  type: "result" | "view";
  action: () => void | Promise<void>;
  viewPath?: string;
}

export interface Extension {
  search: (query: string) => Promise<ExtensionResult[]>;
}
