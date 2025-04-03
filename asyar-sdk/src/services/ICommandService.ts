import { CommandHandler, ExtensionAction } from '../types';

export interface ICommandService {
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    actions?: Omit<ExtensionAction, 'extensionId'>[] // Add actions from manifest
  ): void;
  unregisterCommand(commandId: string): void;
  executeCommand(commandId: string, args?: Record<string, any>): Promise<any>;
  getCommands(): string[];
  getCommandsForExtension(extensionId: string): string[];
  clearCommandsForExtension(extensionId: string): void;
}
