import { logService } from "../log/logService";
import type { ExtensionAction, IActionService } from "asyar-sdk/contracts";
import { ActionContext } from "asyar-sdk/contracts";
import * as commands from "../../lib/ipc/commands";
import { searchService } from "../search/SearchService";
import { searchOrchestrator } from "../search/searchOrchestrator.svelte";
import { searchStores } from "../search/stores/search.svelte";
import { feedbackService } from "../feedback/feedbackService.svelte";
import { applicationService } from "../application/applicationService";
import type { UninstallScanResult } from "../application/applicationService";
import { writeText } from "tauri-plugin-clipboard-x-api";
import { platform } from "@tauri-apps/plugin-os";

// Module-level platform detection for the Uninstall action. macOS moves the
// .app bundle to Trash via `trash::delete`; Windows resolves the .lnk
// shortcut's display name against the registry's Uninstall keys and launches
// the vendor UninstallString. Linux is unsupported — packaging is too
// fragmented (apt/dnf/pacman/flatpak/snap/AppImage) for a single first-party
// path — and the action stays hidden there.
const HOST_PLATFORM: "macos" | "windows" | "other" = (() => {
  try {
    const p = platform();
    if (p === "macos") return "macos";
    if (p === "windows") return "windows";
    return "other";
  } catch {
    return "other";
  }
})();
const IS_MACOS = HOST_PLATFORM === "macos";
const IS_WINDOWS = HOST_PLATFORM === "windows";
const UNINSTALL_SUPPORTED = IS_MACOS || IS_WINDOWS;

/** Human-readable byte size. Matches Finder-style rounding (1 KB = 1000 B). */
function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unitIdx = 0;
  while (value >= 1000 && unitIdx < units.length - 1) {
    value /= 1000;
    unitIdx++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIdx]}`;
}

/** Message body for the macOS uninstall confirm sheet. */
function buildMacosConfirmMessage(appName: string, scan: UninstallScanResult): string {
  const lines: string[] = [];
  const total = formatBytes(scan.totalBytes);
  if (scan.dataPaths.length === 0) {
    lines.push(
      `This will move ${appName} to the Trash (${total}). You can restore it from there later.`,
    );
  } else {
    lines.push(
      `This will move ${appName} and ${scan.dataPaths.length} associated ${
        scan.dataPaths.length === 1 ? "file" : "files"
      } to the Trash — ${total} total. You can restore from Trash if needed.`,
    );
  }
  return lines.join(" ");
}

// This interface might need adjustment if ApplicationAction should also use the enum
export interface ApplicationAction {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  category?: string;
  extensionId?: string;
  disabled?: boolean;
  context?: ActionContext; // Use the enum type here too for consistency
  confirm?: boolean;
  execute: () => Promise<void> | void;
  shortcut?: string;
  visible?: () => boolean;
}

/**
 * ActionService implementation for the main application
 * Connects extension actions to the application UI
 */
export class ActionService implements IActionService {
  private allActions: Map<string, ApplicationAction> = new Map();
  private currentContext: ActionContext = ActionContext.CORE;
  private sendToExtension?: (extensionId: string, actionId: string, role?: 'view' | 'worker') => void;
  // Which iframe role registered the handler for a given full actionId
  // (`act_<extensionId>_<shortId>`). Populated by the IPC router from the
  // calling iframe's data-role attribute when the SDK calls
  // actions:registerActionHandler. Consumed by executeAction so the launcher
  // posts asyar:action:execute to the iframe that actually owns the handler.
  // Absent = legacy single-iframe extension or handler never registered.
  private handlerRoles: Map<string, 'view' | 'worker'> = new Map();

  // Svelte 5 reactive state
  public filteredActions = $state<ApplicationAction[]>([]);

  constructor() {
    this.registerBuiltInActions();
    this.updateState();
  }

  setExtensionForwarder(fn: (extensionId: string, actionId: string, role?: 'view' | 'worker') => void): void {
    this.sendToExtension = fn;
  }

  /**
   * Stamp which iframe role owns the handler for a manifest-declared action.
   * Called by ExtensionIpcRouter when the SDK round-trips
   * actions:registerActionHandler. The short `actionId` is whatever the
   * extension passed to registerActionHandler; we key on the full
   * `act_<extensionId>_<actionId>` so lookups on dispatch are direct.
   */
  recordActionHandlerRole(extensionId: string, actionId: string, role: 'view' | 'worker'): void {
    this.handlerRoles.set(`act_${extensionId}_${actionId}`, role);
  }

  getActionHandlerRole(fullActionId: string): 'view' | 'worker' | undefined {
    return this.handlerRoles.get(fullActionId);
  }

  /**
   * Set the current action context and optional data (e.g., commandId)
   */
  setContext(context: ActionContext): void {
    // Only update if context actually changes
    if (this.currentContext !== context) {
      this.currentContext = context;
      logService.debug(`Action context set to: ${context}`);
      this.updateState(); // Update the Svelte state with filtered actions
    }
  }

  /**
   * Get the current action context
   */
  getContext(): ActionContext {
    return this.currentContext;
  }

  /**
   * Register an action from an extension or core
   */
  registerAction(action: ExtensionAction | ApplicationAction): void {
    // Ensure it conforms to ApplicationAction structure internally
    const appAction: ApplicationAction = {
      id: action.id,
      label: "title" in action ? action.title : action.label, // Handle both interfaces
      icon: action.icon,
      description: action.description,
      extensionId: "extensionId" in action ? action.extensionId : undefined,
      category: action.category,
      // Use the context provided, default if necessary, ensure it's the enum type
      context: action.context || ActionContext.EXTENSION_VIEW,
      confirm: "confirm" in action ? action.confirm : undefined,
      shortcut: "shortcut" in action ? action.shortcut : undefined,
      execute: action.execute,
      disabled: "disabled" in action ? action.disabled : undefined,
      visible: "visible" in action ? (action as any).visible : undefined,
    };

    this.allActions.set(appAction.id, appAction); // Store in the master list
    logService.debug(
      `Registered action: ${appAction.id} from ${
        appAction.extensionId || "core"
      }, context: ${appAction.context || "default"}`
    );

    // Update the state if the action matches the current context
    this.updateState();
  }

  /**
   * Unregister an action
   */
  unregisterAction(actionId: string): void {
    const hadAction = this.allActions.delete(actionId);
    const hadRole = this.handlerRoles.delete(actionId);
    if (hadAction) {
      logService.debug(`Unregistered action: ${actionId}`);
      this.updateState();
    } else if (!hadRole) {
      logService.warn(
        `Attempted to unregister non-existent action: ${actionId}`
      );
    }
  }

  /**
   * Remove all actions registered by a specific extension.
   * Call this when an extension view is closed to prevent stale actions from persisting.
   */
  clearActionsForExtension(extensionId: string): void {
    let changed = false;
    for (const [id, action] of this.allActions) {
      if (action.extensionId === extensionId) {
        this.allActions.delete(id);
        changed = true;
      }
    }
    // Drop stored handler-role entries even if no metadata exists — the SDK
    // may have rolled up handlers before registerAction arrived, or an
    // extension may have registered a handler for a manifest-only action.
    const rolePrefix = `act_${extensionId}_`;
    for (const key of this.handlerRoles.keys()) {
      if (key.startsWith(rolePrefix)) {
        this.handlerRoles.delete(key);
      }
    }
    if (changed) {
      logService.debug(`[ActionService] Cleared all actions for extension: ${extensionId}`);
      this.updateState();
    }
  }

  /**
   * Get all registered actions (primarily for internal use or debugging)
   * Note: This returns ALL actions, not filtered by context.
   */
  getAllActions(): ApplicationAction[] {
    return Array.from(this.allActions.values());
  }

  /**
   * Get actions filtered by the current context
   */
  private getFilteredActions(): ApplicationAction[] {
    const filtered = Array.from(this.allActions.values()).filter(
      this.filterActionsByContext.bind(this)
    );

    // Log details about filtered actions
    logService.debug(
      `Filtering actions for context: ${this.currentContext}. Found ${filtered.length} actions.`
    );

    return filtered;
  }

  /**
   * Get actions based on a specific context (implements IActionService method)
   */
  getActions(context?: ActionContext): ExtensionAction[] {
    const targetContext = context || this.currentContext;
    if (targetContext === ActionContext.COMMAND_RESULT) {
      logService.warn(
        "getActions(COMMAND_RESULT) called directly; may not return correct results."
      );
    }
    return Array.from(this.allActions.values())
      .filter((action) => action.context === targetContext) // Simple context filter for this specific method
      .map((action) => ({
        // Map back to ExtensionAction interface
        id: action.id,
        title: action.label,
        description: action.description,
        icon: action.icon,
        // Ensure extensionId is a string, default to 'core' if undefined
        extensionId: action.extensionId || "core",
        category: action.category,
        context: action.context, // Pass context through
        execute: action.execute,
      }));
  }

  /**
   * Filter actions based on the current internal context
   */
  private filterActionsByContext(action: ApplicationAction): boolean {
    // If a visibility callback is defined and returns false, hide the action
    if (action.visible && !action.visible()) {
      return false;
    }

    // Handle specific contexts (EXTENSION_VIEW, CORE, etc.)
    if (action.context === this.currentContext) {
      return true;
    }

    // Handle GLOBAL actions - show them in CORE and EXTENSION_VIEW contexts
    if (
      action.context === ActionContext.GLOBAL &&
      (this.currentContext === ActionContext.CORE ||
        this.currentContext === ActionContext.EXTENSION_VIEW)
    ) {
      return true;
    }

    // Fallback: If context is CORE, show CORE actions only if no context-specific actions are available
    if (
      this.currentContext === ActionContext.CORE &&
      action.context === ActionContext.CORE
    ) {
      const specificActionCount = Array.from(this.allActions.values()).filter(
        (a) =>
          a.context === this.currentContext &&
          a.context !== ActionContext.CORE &&
          a.context !== ActionContext.GLOBAL
      ).length;
      return specificActionCount === 0;
    }

    return false;
  }

  /**
   * Execute an action by ID
   */
  async executeAction(actionId: string): Promise<void> {
    const action = this.allActions.get(actionId); // Get from the master list
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    logService.info(
      `Executing action: ${actionId} from ${action.extensionId || "core"}`
    );

    try {
      if (typeof action.execute === 'function') {
        await action.execute();
      } else if (action.extensionId && this.sendToExtension) {
        // Forward the stored role (if any) so the iframe manager can target
        // the correct iframe. undefined = legacy/unknown — let the forwarder
        // fall back to view-prefer default.
        this.sendToExtension(action.extensionId, actionId, this.handlerRoles.get(actionId));
      } else {
        throw new Error(`Action execute is not a function: ${actionId}`);
      }
    } catch (error) {
      logService.error(`Error executing action ${actionId}: ${error}`);
      throw error;
    }
  }

  /**
   * Register built-in application actions
   */
  private registerBuiltInActions() {
    this.registerAction({
      id: "settings",
      label: "Settings",
      icon: "icon:settings",
      description: "Configure application settings",
      category: "System",
      context: ActionContext.CORE,
      execute: async () => {
        logService.info("Executing built-in action: Open Settings");
        try {
          await commands.showSettingsWindow();
        } catch (err) {
          logService.error(`Failed to open settings window: ${err}`);
        }
      },
    });

    this.registerAction({
      id: "reset_search",
      label: "Reset Search Index",
      icon: "icon:refresh",
      description: "Reset the search index",
      category: "System",
      context: ActionContext.CORE,
      execute: async () => {
        logService.info("Executing built-in action: Reset Search Index");
        await searchService.resetIndex();
      },
    });

    this.registerAction({
      id: "uninstall_application",
      label: "Uninstall Application",
      icon: "icon:trash",
      description: IS_MACOS
        ? "Move this application to the Trash"
        : "Launch the installer to remove this application",
      category: "Danger",
      context: ActionContext.CORE,
      shortcut: "⌘⌫",
      confirm: true,
      visible: () => {
        if (!UNINSTALL_SUPPORTED) return false;
        const idx = searchStores.selectedIndex;
        if (idx < 0) return false;
        const item = searchOrchestrator.items[idx];
        if (!item || item.type !== "application") return false;
        if (!item.path) return false;
        // macOS-only: hard block system-protected apps from even showing the
        // action. Rust repeats the check as defense-in-depth, but this keeps
        // the UI honest. Windows has no equivalent single-prefix system
        // boundary — the registry SystemComponent flag is the backstop
        // instead, enforced by ensure_windows_entry_allowed in Rust.
        if (IS_MACOS && item.path.startsWith("/System/")) return false;
        return true;
      },
      execute: async () => {
        const idx = searchStores.selectedIndex;
        if (idx < 0) return;
        const item = searchOrchestrator.items[idx];
        if (!item || item.type !== "application" || !item.path) return;

        const appName = item.name;
        const appPath = item.path;

        // macOS: pre-scan user-data paths so the confirm sheet can show the
        // user exactly what will be trashed + total reclaimed space. If the
        // scan fails, fall back to the app-only confirm — worst case the
        // user re-runs it manually. Windows skips the scan entirely; the
        // vendor uninstaller handles data cleanup.
        let dataPaths: string[] = [];
        let confirmMessage: string;

        if (IS_MACOS) {
          try {
            const scan = await applicationService.scanUninstallTargets(appPath);
            dataPaths = scan.dataPaths.map((p) => p.path);
            confirmMessage = buildMacosConfirmMessage(appName, scan);
          } catch (err) {
            logService.warn(
              `Uninstall scan failed for '${appPath}': ${err}. Falling back to app-only confirm.`,
            );
            confirmMessage = `This will move ${appName} to the Trash. You can restore it from there later.`;
          }
        } else {
          // Windows
          confirmMessage = `This will launch the uninstaller for ${appName}. The vendor's uninstaller will take over from there.`;
        }

        const confirmButton = IS_MACOS ? "Move to Trash" : "Open Uninstaller";
        const successHud = IS_MACOS ? "Moved to Trash" : "Uninstaller launched";

        const confirmed = await feedbackService.confirmAlert({
          title: `Uninstall ${appName}?`,
          message: confirmMessage,
          confirmText: confirmButton,
          variant: "danger",
        });
        if (!confirmed) return;

        try {
          await applicationService.uninstallApplication(appPath, dataPaths);
          await feedbackService.showHUD(successHud);
        } catch (err) {
          logService.error(`Uninstall failed for '${appPath}': ${err}`);
          const reason = err instanceof Error ? err.message : String(err);
          await feedbackService.showHUD(`Uninstall failed: ${reason}`);
        }
      },
    });

    this.registerAction({
      id: "copy_deeplink",
      label: "Copy Deeplink",
      icon: "icon:link",
      description: "Copy a deep link URL for this command",
      category: "Share",
      context: ActionContext.CORE,
      shortcut: "⌘⇧C",
      visible: () => {
        const idx = searchStores.selectedIndex;
        if (idx < 0) return false;
        const item = searchOrchestrator.items[idx];
        return item?.type === "command";
      },
      execute: async () => {
        const idx = searchStores.selectedIndex;
        if (idx < 0) return;
        const item = searchOrchestrator.items[idx];
        if (!item || item.type !== "command" || !item.extensionId) return;

        const extensionId = item.extensionId;
        const commandId = item.objectId.slice(
          "cmd_".length + extensionId.length + 1,
        );
        const url = `asyar://extensions/${encodeURIComponent(extensionId)}/${encodeURIComponent(commandId)}`;

        await writeText(url);
        await feedbackService.showHUD("Deeplink Copied to Clipboard");
      },
    });
  }

  /**
   * Update the reactive state with currently relevant actions based on context.
   */
  private updateState() {
    this.filteredActions = this.getFilteredActions();
  }

  /**
   * No-op on the host side — this method exists only on the SDK proxy for
   * Tier 2 extensions to register iframe-local handlers. Tier 1 built-ins
   * call setActionExecutor() instead.
   */
  registerActionHandler(_actionId: string, _handler: () => Promise<void> | void): void {
    // intentional no-op
  }

  /**
   * Wire an execute callback into an already-registered action without
   * overwriting its other fields (visible, label, context, etc.).
   *
   * Use this for Tier 1 built-in extensions that want to respond to
   * manifest-declared actions: the host registers the action metadata +
   * visible() callback; the extension calls setActionExecutor() in
   * initialize() to supply the actual handler.
   *
   * No-op if the action does not exist yet.
   */
  setActionExecutor(actionId: string, executor: () => Promise<void> | void): void {
    const action = this.allActions.get(actionId);
    if (!action) return;
    action.execute = executor;
  }

  /**
   * Public trigger for re-filtering actions.
   * Call when external state (e.g. selected search result) changes
   * and visible() callbacks need re-evaluation.
   */
  refreshFiltered(): void {
    this.updateState();
  }
}

export const actionService = new ActionService();

// Backward compatibility for actionStore
export const actionStore = {
  get subscribe() {
    return (fn: (v: ApplicationAction[]) => void) => {
      fn(actionService.filteredActions);
      return () => {};
    };
  }
};
