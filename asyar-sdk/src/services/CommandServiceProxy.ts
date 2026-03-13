import { ICommandService } from "./ICommandService";
import { CommandHandler, ExtensionAction } from "../types";
import { MessageBroker } from "../ipc/MessageBroker";
import { ExtensionBridge } from "../ExtensionBridge";

export class CommandServiceProxy implements ICommandService {
  private broker: MessageBroker;

  constructor() {
    this.broker = MessageBroker.getInstance();
  }

  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    actions?: Omit<ExtensionAction, 'extensionId'>[]
  ): void {
    // We register it locally so the extension can handle it when called back.
    ExtensionBridge.getInstance().registerCommand(commandId, handler, extensionId);

    // Notify the main app
    this.broker.invoke('command:registerCommand', { commandId, extensionId, actions }).catch(console.error);
  }

  unregisterCommand(commandId: string): void {
    ExtensionBridge.getInstance().unregisterCommand(commandId);
    this.broker.invoke('command:unregisterCommand', { commandId }).catch(console.error);
  }

  executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    return this.broker.invoke<any>('command:executeCommand', { commandId, args });
  }

  getCommands(): string[] {
    console.warn('getCommands called synchronously in proxy.');
    return ExtensionBridge.getInstance().getCommands();
  }

  getCommandsForExtension(extensionId: string): string[] {
    console.warn('getCommandsForExtension called synchronously in proxy.');
    return ExtensionBridge.getInstance().getCommandsForExtension(extensionId);
  }

  clearCommandsForExtension(extensionId: string): void {
    // It's tricky to implement synchronously when the master list is in main.
    // Assuming mostly local clearing is needed inside iframe.
    this.broker.invoke('command:clearCommandsForExtension', { extensionId }).catch(console.error);
  }
}
