import { ExtensionContext } from "./ExtensionContext";
import type { Extension, ExtensionManifest } from "./types/ExtensionType";
import type { ExtensionAction } from "./types/ActionType";
import type { CommandHandler } from "./types/CommandType";
import { MessageBroker } from "./ipc/MessageBroker";
import type { IPCMessage, IPCResponse } from "./ipc/MessageBroker";
import { LogServiceProxy } from "./services/LogServiceProxy";
import type { ILogService } from "./services/LogService";

// Define the bridge that will be used to communicate between extensions and the base app
export class ExtensionBridge {
  private static instance: ExtensionBridge;
  private extensionManifests: Map<string, ExtensionManifest> = new Map();
  private extensionImplementations: Map<string, Extension> = new Map();
  private componentRegistry: Record<string, any> = {};
  private actionRegistry: Map<string, ExtensionAction> = new Map();
  private commandRegistry: Map<
    string,
    { handler: CommandHandler; extensionId: string }
  > = new Map();
  private broker: MessageBroker;
  private logger: ILogService;

  private constructor() {
    this.logger = new LogServiceProxy();
    this.broker = MessageBroker.getInstance();
    this.setupIPCListeners();
    this.logger.debug("ExtensionBridge instance created");
  }



  // Singleton pattern
  public static getInstance(): ExtensionBridge {
    if (!ExtensionBridge.instance) {
      ExtensionBridge.instance = new ExtensionBridge();
    }
    return ExtensionBridge.instance;
  }

  private setupIPCListeners() {
    // Listen for events from main app
    this.broker.on('asyar:invoke:command', async (data: IPCMessage<{ commandId: string, args?: any }>) => {
      try {
        const result = await this.executeCommand(data.payload!.commandId, data.payload!.args);
        this.broker.send({
          type: 'asyar:response',
          messageId: data.messageId,
          result
        } as IPCResponse);
      } catch (err: any) {
        this.broker.send({
          type: 'asyar:response',
          messageId: data.messageId,
          error: err.message || String(err)
        } as IPCResponse);
      }
    });

    // Listen for search requests from the host
    if (typeof window !== 'undefined') {
      window.addEventListener('message', async (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        // Handle action execution (moved from constructor)
        if (data.type === 'asyar:action:execute') {
          const actionId = data.payload?.actionId;
          if (actionId) {
            const action = this.actionRegistry.get(actionId);
            if (action?.execute) {
              Promise.resolve(action.execute()).catch((err: Error) => this.logger.error(err));
            }
          }
          return;
        }

        // Handle search requests (existing logic)
        if (data.type !== 'asyar:search:request') return;

        const { messageId, payload } = data;
        const query = payload?.query ?? '';

        try {
          // Call the extension's search() method if it exists
          let results: any[] = [];
          for (const extension of this.extensionImplementations.values()) {
            if (extension.search) {
              const extResults = await extension.search(query) ?? [];
              results = [
                ...results,
                ...extResults.map((r) => ({
                  title: r.title,
                  subtitle: r.subtitle,
                  score: r.score ?? 0.5,
                  icon: r.icon,
                  type: r.type,
                  style: r.style,
                  viewPath: r.viewPath,
                  // Do NOT send `action` — functions can't be serialized via postMessage
                })),
              ];
            }
          }

          // Send results back to host
          window.parent.postMessage(
            {
              type: 'asyar:search:response',
              messageId,
              result: results,
            },
            '*'
          );
        } catch (error: any) {
          window.parent.postMessage(
            {
              type: 'asyar:search:response',
              messageId,
              error: error.message || String(error),
            },
            '*'
          );
        }
      });
    }
  }

  // Register a service implementation from the base app
  registerService(serviceType: string, implementation: any): void {
    // Deprecated in new architecture, services are proxied
    this.logger.warn(`registerService is deprecated. Service ${serviceType} is now proxied.`);
  }

  // Component proxying has been removed in the new architecture. 
  // Extensions should bundle their own components.

  // Register an action from an extension
  registerAction(extensionId: string, action: ExtensionAction): void {
    const actionId = action.id;
    this.actionRegistry.set(actionId, {
      ...action,
      id: actionId,
      extensionId,
    });
    this.logger.debug(`Registered action: ${actionId}`);
  }

  // Unregister an action
  unregisterAction(actionId: string): void {
    this.actionRegistry.delete(actionId);
  }

  // Get all registered actions
  getActions(): ExtensionAction[] {
    return Array.from(this.actionRegistry.values());
  }

  // Register an extension manifest
  registerManifest(manifest: ExtensionManifest): void {
    this.extensionManifests.set(manifest.id, manifest);
    this.logger.debug(`Registered extension manifest: ${manifest.id} (${manifest.name} v${manifest.version})`);
  }

  // Register extension implementation
  registerExtensionImplementation(id: string, extension: Extension): void {
    if (!this.extensionManifests.has(id)) {
      this.logger.error(`Cannot register extension implementation: Manifest for ${id} not found`);
      return;
    }

    this.extensionImplementations.set(id, extension);
    this.logger.debug(`Registered extension implementation for: ${id}`);
  }

  // Initialize all registered extensions
  async initializeExtensions(): Promise<void> {
    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) {
        this.logger.error(`Cannot initialize extension: Manifest for ${id} not found`);
        continue;
      }

      this.logger.debug(`Initializing extension: ${manifest.id} (${manifest.name})`);
      const context = new ExtensionContext();
      context.setExtensionId(manifest.id);
      await extension.initialize(context);
    }
  }

  // Activate all registered extensions
  async activateExtensions(): Promise<void> {
    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) continue;

      this.logger.debug(`Activating extension: ${manifest.id}`);
      await extension.activate();
    }
  }

  // Deactivate all registered extensions
  async deactivateExtensions(): Promise<void> {
    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) continue;

      this.logger.debug(`Deactivating extension: ${manifest.id}`);
      await extension.deactivate();
    }
  }

  // Get all registered extension manifests
  getManifests(): ExtensionManifest[] {
    return Array.from(this.extensionManifests.values());
  }

  // Get manifest by extension ID
  getManifest(id: string): ExtensionManifest | undefined {
    return this.extensionManifests.get(id);
  }

  // Get extension implementation by ID
  getExtensionImplementation(id: string): Extension | undefined {
    return this.extensionImplementations.get(id);
  }

  // Register a command from an extension
  registerCommand(
    commandId: string,
    handler: CommandHandler,
    extensionId: string
  ): void {
    this.commandRegistry.set(commandId, { handler, extensionId });
    this.logger.debug(`Registered command: ${commandId}`);
  }

  // Unregister a command
  unregisterCommand(commandId: string): void {
    this.commandRegistry.delete(commandId);
  }

  // Execute a command
  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    const command = this.commandRegistry.get(commandId);
    if (!command) {
      throw new Error(`Command not found: ${commandId}`);
    }
    return command.handler.execute(args);
  }

  // Get all registered commands
  getCommands(): string[] {
    return Array.from(this.commandRegistry.keys());
  }

  // Get commands for a specific extension
  getCommandsForExtension(extensionId: string): string[] {
    return Array.from(this.commandRegistry.entries())
      .filter(([_, value]) => value.extensionId === extensionId)
      .map(([key, _]) => key);
  }
}
