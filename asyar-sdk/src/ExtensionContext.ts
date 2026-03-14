import { ExtensionAction } from "./types/ActionType";
import { CommandHandler } from "./types/CommandType";
import {
  LogServiceProxy,
  NotificationServiceProxy,
  ClipboardHistoryServiceProxy,
  ExtensionManagerProxy,
  CommandServiceProxy,
  ActionServiceProxy
} from "./services";

// Define the context that will be passed to extensions
export class ExtensionContext {
  private serviceRegistry: Record<string, any>;
  private extensionId: string = "";

  constructor(
    serviceRegistry: Record<string, any> = {}
  ) {
    // We instantiate the proxies instead of relying on passed-in instances for the core services
    this.serviceRegistry = {
      ...serviceRegistry,
      LogService: new LogServiceProxy(),
      NotificationService: new NotificationServiceProxy(),
      ClipboardHistoryService: new ClipboardHistoryServiceProxy(),
      ExtensionManager: new ExtensionManagerProxy(),
      CommandService: new CommandServiceProxy(),
      ActionService: new ActionServiceProxy(),
    };
  }

  // Method to get a service by its interface name
  getService<T>(serviceType: string): T{
    console.log("Getting service:", serviceType); // Add this line
    const service = this.serviceRegistry[serviceType];
    if (!service) {
      throw new Error(`Service "${serviceType}" not registered`);
    }
    return service as T;
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
  }

  registerAction(action: ExtensionAction): void {
    const bridge = ExtensionBridge.getInstance();
    if (this.extensionId) {
      bridge.registerAction(this.extensionId, action);

      // We also need to notify the ActionServiceProxy to send the IPC message
      const actionService = this.getService<ActionServiceProxy>('ActionService');
      actionService.registerAction(action);
    } else {
      console.error("Cannot register action: Extension ID not set");
    }
  }

  unregisterAction(actionId: string): void {
    const bridge = ExtensionBridge.getInstance();
    bridge.unregisterAction(`${this.extensionId}:${actionId}`);

    const actionService = this.getService<ActionServiceProxy>('ActionService');
    actionService.unregisterAction(`${this.extensionId}:${actionId}`);
  }

  registerCommand(commandId: string, handler: CommandHandler): void {
    const bridge = ExtensionBridge.getInstance();
    if (this.extensionId) {
      const fullCommandId = `${this.extensionId}.${commandId}`;
      bridge.registerCommand(
        fullCommandId,
        handler,
        this.extensionId
      );

      const commandService = this.getService<CommandServiceProxy>('CommandService');
      commandService.registerCommand(fullCommandId, handler, this.extensionId);
    } else {
      console.error("Cannot register command: Extension ID not set");
    }
  }

  unregisterCommand(commandId: string): void {
    const fullCommandId = `${this.extensionId}.${commandId}`;
    const bridge = ExtensionBridge.getInstance();
    bridge.unregisterCommand(fullCommandId);

    const commandService = this.getService<CommandServiceProxy>('CommandService');
    commandService.unregisterCommand(fullCommandId);
  }
}

// Import at the end to avoid circular dependencies
import { ExtensionBridge } from "./ExtensionBridge";
