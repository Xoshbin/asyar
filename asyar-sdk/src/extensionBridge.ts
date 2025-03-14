import { ExtensionContext } from "./ExtensionContext";
import { Extension, ExtensionManifest } from "./types/ExtensionType";
import { ExtensionAction } from "./types/ActionType";

// Define the bridge that will be used to communicate between extensions and the base app
export class ExtensionBridge {
  private static instance: ExtensionBridge;
  private extensionManifests: Map<string, ExtensionManifest> = new Map();
  private extensionImplementations: Map<string, Extension> = new Map();
  private serviceRegistry: Record<string, any> = {};
  private componentRegistry: Record<string, any> = {};
  private actionRegistry: Map<string, ExtensionAction> = new Map();

  private constructor() {}

  // Singleton pattern
  public static getInstance(): ExtensionBridge {
    if (!ExtensionBridge.instance) {
      ExtensionBridge.instance = new ExtensionBridge();
      console.log("ExtensionBridge created:", ExtensionBridge.instance);
    }
    console.log("ExtensionBridge instance:", ExtensionBridge.instance);
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

  // Register an extension manifest
  registerManifest(manifest: ExtensionManifest): void {
    this.extensionManifests.set(manifest.id, manifest);
    console.log(
      `Registered extension manifest: ${manifest.id} (${manifest.name} v${manifest.version})`
    );
  }

  // Register extension implementation
  registerExtensionImplementation(id: string, extension: Extension): void {
    if (!this.extensionManifests.has(id)) {
      console.error(
        `Cannot register extension implementation: Manifest for ${id} not found`
      );
      return;
    }

    this.extensionImplementations.set(id, extension);
    console.log(`Registered extension implementation for: ${id}`);
  }

  // Initialize all registered extensions
  async initializeExtensions(): Promise<void> {
    const context = new ExtensionContext(this.serviceRegistry);

    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) {
        console.error(
          `Cannot initialize extension: Manifest for ${id} not found`
        );
        continue;
      }

      console.log(`Initializing extension: ${manifest.id} (${manifest.name})`);
      context.setExtensionId(manifest.id);
      await extension.initialize(context);
    }
  }

  // Activate all registered extensions
  async activateExtensions(): Promise<void> {
    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) continue;

      console.log(`Activating extension: ${manifest.id}`);
      await extension.activate();
    }
  }

  // Deactivate all registered extensions
  async deactivateExtensions(): Promise<void> {
    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) continue;

      console.log(`Deactivating extension: ${manifest.id}`);
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
}
