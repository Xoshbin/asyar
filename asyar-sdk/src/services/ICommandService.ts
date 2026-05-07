import type { CommandHandler, DynamicCommandRegistration, ExtensionAction } from '../types';

export interface ICommandService {
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string,
    actions?: Omit<ExtensionAction, 'extensionId'>[] // Add actions from manifest
  ): void;
  unregisterCommand(commandId: string): void;
  executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown>;
  getCommands(): string[];
  getCommandsForExtension(extensionId: string): string[];
  clearCommandsForExtension(extensionId: string): void;
  updateCommandMetadata(
    commandId: string,
    metadata: { subtitle?: string }
  ): Promise<void>;
  /**
   * Replace this extension's dynamic command list with the given set.
   * Worker-only — the proxy method asserts `__ASYAR_ROLE__ === 'worker'`
   * at call time. Calling from the view iframe rejects.
   *
   * The SDK proxy and the launcher's host-side `CommandService` have
   * different argument shapes (the proxy injects extensionId from the
   * wire envelope; the host receives it as a positional arg from the
   * IPC router). The host class therefore deviates structurally from
   * this signature in the same way `updateCommandMetadata` does — an
   * accepted pattern in the launcher. Extension authors only see this
   * proxy-side signature.
   */
  replaceDynamicCommands(regs: DynamicCommandRegistration[]): Promise<void>;
}
