import { ExtensionContext } from "./ExtensionContext";
import { Extension } from "./types/ExtensionType";
import { ExtensionAction } from "./types/ActionType";

// Define the bridge that will be used to communicate between extensions and the base app
export class ExtensionBridge {
  private static instance: ExtensionBridge;
  private registeredExtensions: Map<string, Extension> = new Map();
  private serviceRegistry: Record<string, any> = {};
  private componentRegistry: Record<string, any> = {}; // New component registry
  private actionRegistry: Map<string, ExtensionAction> = new Map(); // Action registry

  private constructor() {}

  // Singleton pattern
  public static getInstance(): ExtensionBridge {
    if (!ExtensionBridge.instance) {
      ExtensionBridge.instance = new ExtensionBridge();
      console.log("ExtensionBridge created:", ExtensionBridge.instance); // Add this line
    }
    console.log("ExtensionBridge instance:", ExtensionBridge.instance); // Add this line
    return ExtensionBridge.instance;
  }

  // Register a service implementation from the base app
  registerService(serviceType: string, implementation: any): void {
    this.serviceRegistry[serviceType] = implementation;
    console.log(`Registered service: ${serviceType}`);
  }

  // Register a UI component from the base app
  registerComponent(componentName: string, component: any): void {
    this.componentRegistry[componentName] = component;
    console.log(`Registered component: ${componentName}`);
  }

  // Get a registered component
  getComponent(componentName: string): any {
    return this.componentRegistry[componentName];
  }

  // Get all registered components
  getAllComponents(): Record<string, any> {
    return this.componentRegistry;
  }

  // Register an action from an extension
  registerAction(extensionId: string, action: ExtensionAction): void {
    // Add unique ID based on extension
    const actionId = `${extensionId}:${action.id}`;
    this.actionRegistry.set(actionId, {
      ...action,
      id: actionId,
      extensionId,
    });
    console.log(`Registered action: ${actionId}`);
  }

  // Unregister an action
  unregisterAction(actionId: string): void {
    this.actionRegistry.delete(actionId);
  }

  // Get all registered actions
  getActions(): ExtensionAction[] {
    return Array.from(this.actionRegistry.values());
  }

  // Register an extension
  registerExtension(extension: Extension): void {
    this.registeredExtensions.set(extension.id, extension);
    console.log(
      `Registered extension: ${extension.id} (${extension.name} v${extension.version})`
    );
  }

  // Initialize all registered extensions
  async initializeExtensions(): Promise<void> {
    const context = new ExtensionContext(this.serviceRegistry);

    for (const extension of this.registeredExtensions.values()) {
      console.log(`Initializing extension: ${extension.id}`);
      await extension.initialize(context);
    }
  }

  // Activate all registered extensions
  async activateExtensions(): Promise<void> {
    for (const extension of this.registeredExtensions.values()) {
      console.log(`Activating extension: ${extension.id}`);
      await extension.activate();
    }
  }

  // Deactivate all registered extensions
  async deactivateExtensions(): Promise<void> {
    for (const extension of this.registeredExtensions.values()) {
      console.log(`Deactivating extension: ${extension.id}`);
      await extension.deactivate();
    }
  }

  // Get all registered extensions
  getExtensions(): Extension[] {
    return Array.from(this.registeredExtensions.values());
  }
}
