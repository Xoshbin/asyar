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
  icon?: string;
  args: CommandArgument[];
}

export interface CommandArgumentsServiceDeps {
  /** Resolve a command object id to its extension, bare command id, and declared argument list. */
  getManifestByCommandObjectId: (commandObjectId: string) => CommandArgMeta | null;
  /** Dispatch a command through the existing command service. */
  executeCommand: (commandObjectId: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export interface ActiveArgumentMode {
  commandObjectId: string;
  extensionId: string;
  commandId: string;
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

    await this.deps.executeCommand(active.commandObjectId, { arguments: payload });

    // Only clear the mode if the command executed without throwing. If it
    // threw, the user likely wants their inputs preserved so they can retry.
    if (this._active === active) this._active = null;
  }
}
