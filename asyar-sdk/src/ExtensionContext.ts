import type { ExtensionAction } from "./types/ActionType";
import type { CommandHandler } from "./types/CommandType";
import {
  LogServiceProxy,
  NotificationServiceProxy,
  ClipboardHistoryServiceProxy,
  ExtensionManagerProxy,
  CommandServiceProxy,
  ActionServiceProxy,
  NetworkServiceProxy,
  SettingsServiceProxy,
  StatusBarServiceProxy,
} from "./services";

// Define the context that will be passed to extensions
export class ExtensionContext {
  private extensionId: string = "";

  // The local registry is now strictly for proxies
  public readonly proxies = {
    LogService: new LogServiceProxy(),
    NotificationService: new NotificationServiceProxy(),
    ClipboardHistoryService: new ClipboardHistoryServiceProxy(),
    ExtensionManager: new ExtensionManagerProxy(),
    CommandService: new CommandServiceProxy(),
    ActionService: new ActionServiceProxy(),
    NetworkService: new NetworkServiceProxy(),
    SettingsService: new SettingsServiceProxy(),
    StatusBarService: new StatusBarServiceProxy(),
  };

  constructor() {
    this.setupFocusTracking();
  }

  private setupFocusTracking() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    const isInput = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
        const textTypes = ['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'];
        return textTypes.includes(type);
      }
      if ((el as HTMLElement).isContentEditable) return true;
      return false;
    };

    let currentlyFocused = false;
    const emitFocus = (focused: boolean) => {
      // Only emit if we are in an iframe (sandboxed extension)
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'asyar:extension:input-focus', focused }, '*');
      }
    };

    // Use focusin and focusout because they bubble and capture generic focus changes
    document.addEventListener('focusin', (e) => {
      const active = isInput(e.target as Element);
      if (active !== currentlyFocused) {
        currentlyFocused = active;
        emitFocus(currentlyFocused);
      }
    });

    document.addEventListener('focusout', () => {
      // Small timeout to allow the next element to receive focus
      setTimeout(() => {
        const active = isInput(document.activeElement);
        if (active !== currentlyFocused) {
          currentlyFocused = active;
          emitFocus(currentlyFocused);
        }
      }, 0);
    });
  }

  // Method to get a service by its interface name
  getService<T>(serviceType: string): T {
    const service = (this.proxies as any)[serviceType];
    if (!service) {
      throw new Error(`Service "${serviceType}" not registered`);
    }
    return service as T;
  }

  setExtensionId(id: string): void {
    this.extensionId = id;
    // Inject into proxies if they support it
    for (const key of Object.keys(this.proxies)) {
      const svc = (this.proxies as any)[key];
      if (svc && typeof svc.setExtensionId === 'function') {
        svc.setExtensionId(id);
      }
    }
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
    // Use bare actionId — matches the format used in registerAction (no extension prefix)
    const bridge = ExtensionBridge.getInstance();
    bridge.unregisterAction(actionId);

    const actionService = this.getService<ActionServiceProxy>('ActionService');
    actionService.unregisterAction(actionId);
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
