export interface CommandArgument {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description?: string;
  required?: boolean;
  default?: any;
}

export interface CommandDefinition {
  id: string;
  name: string;
  description: string;
  trigger: string;
  arguments?: CommandArgument[];
}

export interface CommandHandler {
  execute: (args?: Record<string, any>) => Promise<any> | any;
}

// New matching system interfaces
export interface CommandMatch {
  // How confident is this match (0-100)
  confidence: number;
  // Extracted arguments from the query
  args?: Record<string, any>;
  // The command ID that matched
  commandId: string;
}

// Extended command interface
export interface ExtendedCommand {
  id: string;
  handler: CommandHandler;
  extensionId: string;
}

// Extended command service interface
export interface ICommandService {
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string
  ): void;
  unregisterCommand(commandId: string): void;
  executeCommand(commandId: string, args?: Record<string, any>): Promise<any>;
  getCommands(): string[];
  getCommandsForExtension(extensionId: string): string[];
  clearCommandsForExtension(extensionId: string): void;
}
