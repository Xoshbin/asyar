import type { ICommandService } from "./ICommandService";
import type { CommandHandler, DynamicCommandRegistration, ExtensionAction } from "../types";
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

  /**
   * Replace this extension's dynamic command list with the given set.
   *
   * Worker-only — the underlying data source (file watcher, OS listing,
   * remote API) lives in the worker so it can fire while the view is
   * Dormant. The runtime guard below mirrors the architectural
   * constraint: registering from the view iframe would silently lose
   * commands across panel-close cycles. Re-asserting the role at the
   * call site means the constraint holds even if a future extension
   * mis-imports the proxy.
   */
  replaceDynamicCommands(regs: DynamicCommandRegistration[]): Promise<void> {
    if (
      typeof window === 'undefined' ||
      (window as { __ASYAR_ROLE__?: unknown }).__ASYAR_ROLE__ !== 'worker'
    ) {
      return Promise.reject(
        new Error(
          '[CommandServiceProxy] replaceDynamicCommands is worker-only. ' +
          'Call this from your extension\'s worker.ts, not view.ts. ' +
          'Dynamic command lists must survive view eviction (Dormant), ' +
          'so registration must live with the always-on worker context.'
        )
      );
    }
    return this.broker.invoke('commands:replaceDynamicCommands', {
      extensionId: this.extensionId,
      regs,
    });
  }
}

