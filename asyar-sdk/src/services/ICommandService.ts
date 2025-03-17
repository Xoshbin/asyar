import { CommandHandler } from "../types";

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
