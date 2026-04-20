import type { ICommandService } from "./ICommandService";
import type { CommandHandler, ExtensionAction } from "../types";
import { BaseServiceProxy } from "./BaseServiceProxy";
import { extensionBridge } from "../ExtensionBridge";

export class CommandServiceProxy extends BaseServiceProxy implements ICommandService {
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    actions?: Omit<ExtensionAction, 'extensionId'>[]
  ): void {
    extensionBridge.registerCommand(commandId, handler, extensionId);
    this.broker.invoke('commands:registerCommand', { commandId, extensionId, actions }).catch(err => console.warn('[CommandServiceProxy] registerCommand failed:', err));
  }

  unregisterCommand(commandId: string): void {
    extensionBridge.unregisterCommand(commandId);
    this.broker.invoke('commands:unregisterCommand', { commandId }).catch(err => console.warn('[CommandServiceProxy] unregisterCommand failed:', err));
  }

  executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    return this.broker.invoke<unknown>('commands:executeCommand', { commandId, args });
  }

  getCommands(): string[] {
    console.warn('getCommands called synchronously in proxy.');
    return extensionBridge.getCommands();
  }

  getCommandsForExtension(extensionId: string): string[] {
    console.warn('getCommandsForExtension called synchronously in proxy.');
    return extensionBridge.getCommandsForExtension(extensionId);
  }

  clearCommandsForExtension(extensionId: string): void {
    this.broker.invoke('commands:clearCommandsForExtension', { extensionId }).catch(err => console.warn('[CommandServiceProxy] clearCommandsForExtension failed:', err));
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

