import { ExtensionAction } from "./types/ActionType";

// Define the context that will be passed to extensions
export class ExtensionContext {
  private serviceRegistry: Record<string, any>;
  private componentRegistry: Record<string, any>;
  private extensionId: string = "";

  constructor(
    serviceRegistry: Record<string, any> = {},
    componentRegistry: Record<string, any> = {}
  ) {
    this.serviceRegistry = serviceRegistry;
    this.componentRegistry = componentRegistry;
  }

  // Method to get a service by its interface name
  getService<T>(serviceType: string): T | undefined {
    console.log("Getting service:", serviceType); // Add this line
    const service = this.serviceRegistry[serviceType];
    if (!service) {
      throw new Error(`Service "${serviceType}" not registered`);
    }
    return service as T;
  }

  getComponent(componentName: string): any {
    return this.componentRegistry[componentName];
  }

  getAllComponents(): Record<string, any> {
    return this.componentRegistry;
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
  }

  registerAction(action: ExtensionAction): void {
    const bridge = ExtensionBridge.getInstance();
    if (this.extensionId) {
      bridge.registerAction(this.extensionId, action);
    } else {
      console.error("Cannot register action: Extension ID not set");
    }
  }

  unregisterAction(actionId: string): void {
    const bridge = ExtensionBridge.getInstance();
    bridge.unregisterAction(`${this.extensionId}:${actionId}`);
  }
}

// Import at the end to avoid circular dependencies
import { ExtensionBridge } from "./ExtensionBridge";
