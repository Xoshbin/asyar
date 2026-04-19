import type { CommandArgument } from 'asyar-sdk';
import { logService } from '../log/logService';
import {
  commandArgDefaultsGet,
  commandArgDefaultsSet,
} from '../../lib/ipc/commandArgDefaultsCommands';

export interface CommandArgMeta {
  extensionId: string;
  commandId: string;
  commandName: string;
  isBuiltIn: boolean;
  icon?: string;
  args: CommandArgument[];
}

export interface ArgumentDispatchRequest {
  extensionId: string;
  commandId: string;
  /** Nested arguments payload already coerced to declared types. */
  args: Record<string, string | number>;
}

export interface CommandArgumentsServiceDeps {
  /** Resolve a command object id to its extension, bare command id, and declared argument list. */
  getManifestByCommandObjectId: (commandObjectId: string) => CommandArgMeta | null;
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
  isBuiltIn: boolean;
  title: string;
  icon?: string;
  args: CommandArgument[];
  values: Record<string, string>;
  currentFieldIdx: number;
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
    const meta = this.deps.getManifestByCommandObjectId(commandObjectId);
    if (!meta) {
      logService.debug(
        `[CommandArgumentsService] enter(${commandObjectId}) — manifest not found`
      );
      return false;
    }
    if (!meta.args.length) {
      return false;
    }

    let persisted: Record<string, string> = {};
    try {
      persisted = await commandArgDefaultsGet(meta.extensionId, meta.commandId);
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to load defaults for ${meta.extensionId}/${meta.commandId}: ${err}`
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
      isBuiltIn: meta.isBuiltIn,
      title: meta.commandName,
      icon: meta.icon,
      args: meta.args,
      values,
      currentFieldIdx: 0,
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
    try {
      await commandArgDefaultsSet(active.extensionId, active.commandId, persist);
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to persist defaults for ${active.extensionId}/${active.commandId}: ${err}`
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
      });
    }

    // Only clear the mode if the command executed without throwing. If it
    // threw, the user likely wants their inputs preserved so they can retry.
    if (this._active === active) this._active = null;
  }
}
