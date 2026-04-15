import type { ICommandService } from "./ICommandService";
import type { CommandHandler, ExtensionAction } from "../types";
import { BaseServiceProxy } from "./BaseServiceProxy";
import { ExtensionBridge } from "../ExtensionBridge";

export class CommandServiceProxy extends BaseServiceProxy implements ICommandService {
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    actions?: Omit<ExtensionAction, 'extensionId'>[]
  ): void {
    ExtensionBridge.getInstance().registerCommand(commandId, handler, extensionId);
    this.broker.invoke('commands:registerCommand', { commandId, extensionId, actions }).catch(console.error);
  }

  unregisterCommand(commandId: string): void {
    ExtensionBridge.getInstance().unregisterCommand(commandId);
    this.broker.invoke('commands:unregisterCommand', { commandId }).catch(console.error);
  }

  executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    return this.broker.invoke<any>('commands:executeCommand', { commandId, args });
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
    this.broker.invoke('commands:clearCommandsForExtension', { extensionId }).catch(console.error);
  }

  updateCommandMetadata(
    commandId: string,
    metadata: { subtitle?: string }
  ): Promise<void> {
    return this.broker.invoke('commands:updateCommandMetadata', {
      extensionId: this.extensionId,
      commandId,
      subtitle: metadata.subtitle ?? null,
    });
  }
}

