import type { CommandArgument } from 'asyar-sdk/contracts';
import { logService } from '../log/logService';
import {
  commandArgDefaultsGet,
  commandArgDefaultsSet,
} from '../../lib/ipc/commandArgDefaultsCommands';

/**
 * Build the SQLite `command_arg_defaults.command_id` storage key for a
 * given command. Manifest commands store under their bare id; dynamic
 * commands get a `dynamic:` prefix so the two id spaces never collide
 * inside a single extension's row set.
 *
 * Mirrored on the Rust side by
 * `storage::command_arg_defaults::dynamic_command_id_key`.
 */
export function persistenceCommandKey(commandId: string, isDynamic: boolean): string {
  return isDynamic ? `dynamic:${commandId}` : commandId;
}

export interface CommandArgMeta {
  extensionId: string;
  /**
   * The bare command identifier — used for the dispatch payload that
   * reaches the extension's `executeCommand(commandId, args)`. For
   * dynamic commands this is the dynamic id as the extension
   * registered it; the `dynamic:` storage prefix is applied internally
   * by the persistence layer when `isDynamic` is true.
   */
  commandId: string;
  commandName: string;
  isBuiltIn: boolean;
  icon?: string;
  args: CommandArgument[];
  /**
   * Manifest-declared execution mode for this command. Drives Tier 2 routing:
   * `"background"` → worker iframe, `"view"` (or omitted) → view iframe.
   */
  mode?: 'view' | 'background';
  /**
   * `true` when this meta describes a runtime-registered dynamic
   * command (resolved through the Rust dynamic command registry).
   * Drives the `dynamic:` namespacing for argument-default persistence
   * so dynamic ids cannot collide with manifest command ids.
   */
  isDynamic?: boolean;
}

export interface ArgumentDispatchRequest {
  extensionId: string;
  commandId: string;
  /** Nested arguments payload already coerced to declared types. */
  args: Record<string, string | number>;
  /**
   * Manifest-declared execution mode. Threaded through so the dispatcher
   * routes to worker vs. view correctly — hardcoding `'view'` here dropped
   * background-mode commands onto the view machine and silently timed out.
   */
  mode: 'view' | 'background';
}

export interface CommandArgumentsServiceDeps {
  /**
   * Resolve a command object id to its extension, bare command id, and
   * declared argument list. Async because dynamic commands round-trip to
   * the Rust registry via IPC; manifest commands resolve synchronously
   * but the dep signature is uniform for both paths.
   */
  getManifestByCommandObjectId: (
    commandObjectId: string,
  ) => Promise<CommandArgMeta | null> | CommandArgMeta | null;
  /**
   * Invoke a Tier 1 (built-in) command directly — same entry point as
   * Enter-on-command. Only called when the resolved meta reports `isBuiltIn`.
   */
  executeBuiltInCommand: (commandObjectId: string, args?: Record<string, unknown>) => Promise<unknown>;
  /**
   * Deliver a Tier 2 argument-mode submission through the extension
   * dispatcher so telemetry and UX affordances (pending glyph, degraded
   * toast) distinguish it from search-initiated execution.
   */
  dispatchTier2Argument: (req: ArgumentDispatchRequest) => Promise<void>;
}

export interface ActiveArgumentMode {
  commandObjectId: string;
  extensionId: string;
  commandId: string;
  /**
   * Mirrors `CommandArgMeta.isDynamic`. Drives the `dynamic:` storage
   * prefix when persisting argument last-values so dynamic ids cannot
   * collide with manifest command ids in `command_arg_defaults`.
   */
  isDynamic: boolean;
  isBuiltIn: boolean;
  title: string;
  icon?: string;
  args: CommandArgument[];
  values: Record<string, string>;
  currentFieldIdx: number;
  mode?: 'view' | 'background';
}

/**
 * Owns the search-bar "argument mode" — the Tab-promoted sub-mode where a
 * selected command becomes a chip and its declared arguments are collected
 * inline. On submit the collected values are passed to `executeCommand`
 * under the `arguments` key and (minus passwords) persisted via Rust so the
 * next invocation pre-fills the chip row.
 *
 * Declared arguments come from the already-loaded manifest, so no extra IPC
 * is needed to enter the mode — only the defaults-get call hits Rust.
 *
 * Values are stored as strings internally (chip inputs always produce strings);
 * `buildArgumentsPayload` coerces numeric fields to `number` on submit.
 */
export class CommandArgumentsService {
  private _active = $state<ActiveArgumentMode | null>(null);

  constructor(private readonly deps: CommandArgumentsServiceDeps) {}

  get active(): ActiveArgumentMode | null {
    return this._active;
  }

  /**
   * Promote a command into argument mode. Loads declared arguments from the
   * manifest and pre-fills with persisted last values (or declared defaults).
   * Returns false if the command can't be resolved or has no arguments.
   */
  async enter(commandObjectId: string): Promise<boolean> {
    const meta = await this.deps.getManifestByCommandObjectId(commandObjectId);
    if (!meta) {
      logService.debug(
        `[CommandArgumentsService] enter(${commandObjectId}) — manifest not found`
      );
      return false;
    }
    if (!meta.args.length) {
      return false;
    }

    const persistenceKey = persistenceCommandKey(meta.commandId, meta.isDynamic === true);
    let persisted: Record<string, string> = {};
    try {
      persisted = (await commandArgDefaultsGet(meta.extensionId, persistenceKey)) ?? {};
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to load defaults for ${meta.extensionId}/${persistenceKey}: ${err}`
      );
    }

    const values: Record<string, string> = {};
    for (const arg of meta.args) {
      if (arg.type === 'password') {
        // Passwords are never persisted and must not be pre-filled.
        values[arg.name] = '';
      } else if (persisted[arg.name] !== undefined) {
        values[arg.name] = persisted[arg.name];
      } else if (arg.default !== undefined) {
        values[arg.name] = String(arg.default);
      } else {
        values[arg.name] = '';
      }
    }

    this._active = {
      commandObjectId,
      extensionId: meta.extensionId,
      commandId: meta.commandId,
      isDynamic: meta.isDynamic === true,
      isBuiltIn: meta.isBuiltIn,
      title: meta.commandName,
      icon: meta.icon,
      args: meta.args,
      values,
      currentFieldIdx: 0,
      mode: meta.mode,
    };
    return true;
  }

  exit(): void {
    this._active = null;
  }

  setValue(name: string, value: string): void {
    if (!this._active) return;
    if (this._active.values[name] === value) return;
    this._active = {
      ...this._active,
      values: { ...this._active.values, [name]: value },
    };
  }

  focusField(idx: number): void {
    if (!this._active) return;
    const max = this._active.args.length - 1;
    const clamped = Math.max(0, Math.min(idx, max));
    if (this._active.currentFieldIdx === clamped) return;
    this._active = { ...this._active, currentFieldIdx: clamped };
  }

  next(): void {
    if (!this._active) return;
    this.focusField(this._active.currentFieldIdx + 1);
  }

  prev(): void {
    if (!this._active) return;
    this.focusField(this._active.currentFieldIdx - 1);
  }

  canSubmit(): boolean {
    if (!this._active) return false;
    for (const arg of this._active.args) {
      const raw = (this._active.values[arg.name] ?? '').trim();
      if (arg.required && !raw) return false;
      if (arg.type === 'number' && raw && !Number.isFinite(Number(raw))) return false;
      if (arg.type === 'number' && arg.required && !Number.isFinite(Number(raw))) return false;
    }
    return true;
  }

  private buildArgumentsPayload(): Record<string, string | number> {
    const payload: Record<string, string | number> = {};
    if (!this._active) return payload;
    for (const arg of this._active.args) {
      const raw = (this._active.values[arg.name] ?? '').trim();
      if (!raw) continue;
      if (arg.type === 'number') {
        payload[arg.name] = Number(raw);
      } else {
        payload[arg.name] = raw;
      }
    }
    return payload;
  }

  async submit(): Promise<void> {
    if (!this._active) return;
    if (!this.canSubmit()) return;

    const active = this._active;
    const payload = this.buildArgumentsPayload();

    // Persist non-password values BEFORE executing — the command may navigate
    // away or close the launcher, and we want the user's input preserved.
    const persist: Record<string, string> = {};
    for (const arg of active.args) {
      if (arg.type === 'password') continue;
      const raw = (active.values[arg.name] ?? '').trim();
      if (!raw) continue;
      persist[arg.name] = raw;
    }
    const persistKey = persistenceCommandKey(active.commandId, active.isDynamic);
    try {
      await commandArgDefaultsSet(active.extensionId, persistKey, persist);
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to persist defaults for ${active.extensionId}/${persistKey}: ${err}`
      );
    }

    if (active.isBuiltIn) {
      // Tier 1: direct JS invocation keeps preference-gating and the existing
      // Tier 1 command path intact. No iframe involved.
      await this.deps.executeBuiltInCommand(active.commandObjectId, { arguments: payload });
    } else {
      // Tier 2: route through the iframe dispatcher so the lifecycle registry
      // handles mount/queue/deliver. Using source: 'argument' keeps telemetry
      // and UX affordances (pending glyph, degraded toast) distinct from the
      // search-Enter path that ExtensionLoader registered with source: 'search'.
      await this.deps.dispatchTier2Argument({
        extensionId: active.extensionId,
        commandId: active.commandId,
        args: payload,
        mode: active.mode ?? 'view',
      });
    }

    // Only clear the mode if the command executed without throwing. If it
    // threw, the user likely wants their inputs preserved so they can retry.
    if (this._active === active) this._active = null;
  }
}
