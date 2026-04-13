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
  private preferences: Map<
    string,
    { extension: Record<string, unknown>; commands: Record<string, Record<string, unknown>> }
  > = new Map();
  private activeContexts: Map<string, ExtensionContext> = new Map();
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
    
    // The broker routes anything under `asyar:event:*` straight to registered
    // listeners with the payload unwrapped (see MessageBroker.handleMessage).
    // That's why the message type uses the `:event:` namespace here instead
    // of a plain `asyar:preferences:set-all` — a non-event message would be
    // filtered out and the listener would silently never fire.
    this.broker.on(
      'asyar:event:preferences:set-all',
      (payload: {
        extension?: Record<string, unknown>;
        commands?: Record<string, Record<string, unknown>>;
      }) => {
        const bundle = {
          extension: payload?.extension ?? {},
          commands: payload?.commands ?? {},
        };
        // Iterate `activeContexts`, not `extensionManifests`. Tier 2 iframes
        // bootstrap via `new ExtensionContext()` directly — they never call
        // `bridge.registerManifest`, so `extensionManifests` is empty. But
        // `activeContexts` is populated by the self-register path in
        // `ExtensionContext.setExtensionId`, so that's where the live
        // contexts live in both Tier 1 and Tier 2.
        //
        // Also store the bundle in `this.preferences` so any context that
        // registers AFTER this message arrives can pick it up via the
        // stash-and-drain path in `registerActiveContext`.
        for (const [id, context] of this.activeContexts) {
          this.preferences.set(id, bundle);
          context.setPreferences(bundle);
        }

        // Race guard: if the reply arrived before any context registered
        // (the iframe posts `asyar:extension:loaded` asynchronously), stash
        // under a sentinel key. The next `registerActiveContext` call will
        // drain it into the real extension id.
        if (this.activeContexts.size === 0) {
          this.preferences.set('__pending__', bundle);
        }
      }
    );

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

        // Handle scheduled/direct command execution from host
        if (data.type === 'asyar:command:execute') {
          const { commandId, args } = data.payload;
          // Each Tier 2 iframe has exactly one extension
          for (const extension of this.extensionImplementations.values()) {
            if (typeof extension.executeCommand === 'function') {
              Promise.resolve(extension.executeCommand(commandId, args))
                .catch((err: Error) => this.logger.error(err));
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

  /**
   * Register a handler for a manifest-declared action.
   * Stores the handler locally in the actionRegistry so the
   * asyar:action:execute message from the host can find it.
   * No IPC message sent — the host already knows about the action from the manifest.
   */
  registerActionHandler(extensionId: string, actionId: string, handler: () => Promise<void> | void): void {
    const fullActionId = `act_${extensionId}_${actionId}`;
    this.actionRegistry.set(fullActionId, {
      id: fullActionId,
      title: actionId,
      extensionId,
      execute: handler,
    });
    this.logger.debug(`Registered action handler: ${fullActionId}`);
  }

  /**
   * Tells the bridge which extension this iframe represents so its internal
   * `LogServiceProxy` can stamp `extensionId` on every IPC log call.
   *
   * Without this, every `this.logger.debug(...)` from the bridge fires a
   * `log:debug` postMessage with no extensionId, and the host's
   * `ExtensionIpcRouter` rejects it as "untrusted frame, no extensionId" —
   * producing per-tick error spam in the dev console for any extension that
   * re-registers actions on a timer (e.g. pomodoro's countdown).
   */
  setExtensionId(extensionId: string): void {
    if (typeof (this.logger as any).setExtensionId === 'function') {
      (this.logger as any).setExtensionId(extensionId);
    }
  }

  /**
   * Register a live `ExtensionContext` with the bridge as the active
   * context for an extension id. This is what lets the
   * `asyar:event:preferences:set-all` listener find the context and
   * call `setPreferences` on it.
   *
   * Tier 2 iframes that bootstrap by creating their own
   * `ExtensionContext` (instead of going through the bridge's
   * `initializeExtensions()` path) must call this so they show up in
   * `activeContexts`. Otherwise the preferences bundle arrives at the
   * bridge but never reaches the live context — it only lands in the
   * `this.preferences` map which is consulted by `initializeExtensions`.
   *
   * Called from `ExtensionContext.setExtensionId`, so Tier 2 iframes get
   * this for free as long as they call `setExtensionId(id)` during boot.
   */
  registerActiveContext(extensionId: string, context: ExtensionContext): void {
    this.activeContexts.set(extensionId, context);
    // If we've already received a preferences bundle for this extension
    // (e.g. boot reply arrived before the context was registered, or a
    // live update landed earlier), deliver it now so the late-joining
    // context sees the latest snapshot immediately. The `__pending__`
    // sentinel key is used when the message arrives before any context
    // is registered — we move it to the real id and clear the sentinel.
    const existing =
      this.preferences.get(extensionId) ??
      this.preferences.get('__pending__');
    if (existing) {
      context.setPreferences(existing);
      this.preferences.set(extensionId, existing);
      this.preferences.delete('__pending__');
    }
  }

  /**
   * Store a preference bundle (extension-level + command-level) for an
   * extension. Called by the host-side ExtensionLoader before the extension
   * is initialized, so that `initializeExtensions` can hand it to the new
   * ExtensionContext as a frozen snapshot.
   */
  setPreferences(
    extensionId: string,
    bundle: { extension: Record<string, unknown>; commands: Record<string, Record<string, unknown>> }
  ): void {
    this.preferences.set(extensionId, bundle);
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
      // `setExtensionId` self-registers the context with the bridge and
      // drains any stashed preferences bundle (either under `manifest.id`
      // or the `__pending__` sentinel). No need to set `activeContexts`
      // or call `setPreferences` directly here — it already happened.
      context.setExtensionId(manifest.id);
      try {
        await extension.initialize(context);
      } catch (error) {
        this.logger.error(`Failed to initialize extension ${manifest.id}: ${error}`);
      }
    }
  }

  // Activate all registered extensions
  async activateExtensions(): Promise<void> {
    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) continue;

      this.logger.debug(`Activating extension: ${manifest.id}`);
      try {
        await extension.activate();
      } catch (error) {
        this.logger.error(`Failed to activate extension ${manifest.id}: ${error}`);
      }
    }
  }

  // Deactivate all registered extensions
  async deactivateExtensions(): Promise<void> {
    for (const [id, extension] of this.extensionImplementations.entries()) {
      const manifest = this.extensionManifests.get(id);
      if (!manifest) continue;

      this.logger.debug(`Deactivating extension: ${manifest.id}`);
      try {
        await extension.deactivate();
      } catch (error) {
        this.logger.error(`Failed to deactivate extension ${manifest.id}: ${error}`);
      }
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
