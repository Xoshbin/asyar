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

/**
 * Whether the argument declares a fallback value. Manifests round-trip
 * through Rust, where an omitted `default` comes back as JSON `null` rather
 * than absent, so `!== undefined` alone treats every argument as defaulted —
 * which skips required-field checks and puts the string "null" in payloads.
 */
export function hasDeclaredDefault(arg: CommandArgument): boolean {
  return arg.default !== undefined && arg.default !== null;
}

/**
 * The values a fresh `enter()` starts from. A `<select>` has no placeholder
 * state, so dropdowns need a concrete value: last-used selection, else the
 * declared default. Everything else starts empty so the placeholder hint
 * shows, and declared defaults apply at submit instead.
 *
 * Shared with the ghost hint chips so the preview matches what Enter sends.
 */
export function seedArgumentValues(
  args: CommandArgument[],
  persisted: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const arg of args) {
    values[arg.name] =
      arg.type === 'dropdown'
        ? (persisted[arg.name] ?? (hasDeclaredDefault(arg) ? String(arg.default) : ''))
        : '';
  }
  return values;
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
   * Argument names of which at least one must carry a user value before the
   * command may run. Covers what `required` cannot: a command that needs
   * SOME input without being able to name which field it comes from.
   */
  requireAnyOf?: string[];
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
  /** Search-result id, for usage ranking and the post-run launcher reset. */
  commandObjectId: string;
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
  executeBuiltInCommand: (
    commandObjectId: string,
    args?: Record<string, unknown>,
  ) => Promise<unknown>;
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
  /**
   * What `enter()` seeded each field with. Kept so a dropdown can be put back
   * to its untouched state after the user has arrowed off it — the default it
   * returns to is the one persistence and the manifest declare, so a stash
   * restore deliberately does not overwrite this.
   */
  seeds: Record<string, string>;
  /**
   * Fields the user actually typed into or picked, plus anything restored
   * from a stash. Auto-seeded dropdowns are absent until touched, so exiting
   * without entering anything leaves no stash behind.
   */
  edited: ReadonlySet<string>;
  /**
   * Fields that have held focus at least once, plus everything flagged by a
   * refused submit. A required field the user has seen and left empty is
   * marked in place; one they never reached stays neutral.
   */
  visited: ReadonlySet<string>;
  /**
   * The field being edited, or -1 when focus sits in the search query. The
   * query is a slot on either side of the row, so "no field" is a real
   * position in the walk rather than an absent one.
   */
  currentFieldIdx: number;
  /**
   * Enter has been pressed and refused, and nothing has been edited since.
   * Standing in a required field is not yet failing to fill it, but once the
   * user has asked for it to run it is, so the field stops being exempt.
   */
  submitRefused: boolean;
  mode?: 'view' | 'background';
  /** Command-level "at least one of these" gate, verbatim from the manifest. */
  requireAnyOf?: string[];
  /**
   * Fields whose seed came from the user rather than from a declared default
   * — a persisted last selection. Together with `edited` this is what makes a
   * field count towards `requireAnyOf`: a default fills a blank, it does not
   * stand in for the user's decision to run.
   */
  seededFromUser: ReadonlySet<string>;
}

/**
 * Values that came from the user rather than from a declared default: typed,
 * restored from a stash, or remembered from a previous run. Empty fields drop
 * out, so a cleared field stops counting the moment it is cleared.
 */
export function userSuppliedValues(active: ActiveArgumentMode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of active.args) {
    const raw = (active.values[arg.name] ?? '').trim();
    if (!raw) continue;
    if (active.edited.has(arg.name) || active.seededFromUser.has(arg.name)) out[arg.name] = raw;
  }
  return out;
}

/**
 * Whether a command's `requireAnyOf` gate is still unmet. Commands without the
 * declaration are never gated by it.
 */
export function requireAnyOfUnsatisfied(
  requireAnyOf: string[] | undefined,
  userValues: Record<string, string>,
): boolean {
  if (!requireAnyOf?.length) return false;
  return !requireAnyOf.some((name) => (userValues[name] ?? '').trim() !== '');
}

/**
 * Arguments the user still owes a value: required, with nothing to fall back
 * on. A declared default counts as filled — it lands in the payload at submit
 * time — as does anything already in `values` (a persisted selection, a
 * stashed entry, or something typed).
 *
 * The single definition of "unfilled" behind both gates: the submit gate
 * inside argument mode, and the one deciding whether Enter on a command has
 * to stop for input at all.
 */
export function unfilledRequiredArgs(
  args: CommandArgument[],
  values: Record<string, string>,
): CommandArgument[] {
  return args.filter(
    (arg) => arg.required && !hasDeclaredDefault(arg) && (values[arg.name] ?? '').trim() === '',
  );
}

/**
 * The `arguments` payload for a set of collected values: every entered value
 * coerced to its declared type, with a declared default standing in wherever
 * the user left a field empty. An argument with neither is left out entirely,
 * so a handler can tell "not given" from "given as empty".
 *
 * Shared by the submit path and the Enter-fires-it-straight-away path, so a
 * command receives the same payload whichever way it was run.
 */
export function buildArgumentsPayload(
  args: CommandArgument[],
  values: Record<string, string>,
): Record<string, string | number> {
  const payload: Record<string, string | number> = {};
  for (const arg of args) {
    const raw = (values[arg.name] ?? '').trim();
    if (!raw) {
      if (hasDeclaredDefault(arg)) {
        payload[arg.name] = arg.type === 'number' ? Number(arg.default) : String(arg.default);
      }
      continue;
    }
    payload[arg.name] = arg.type === 'number' ? Number(raw) : raw;
  }
  return payload;
}

const EMPTY_FLAGGED: ReadonlySet<string> = new Set();

/** What Enter on a command should do, and what it should run with. */
export interface PreparedRun {
  /** A required argument has nothing to stand in for it: collect input first. */
  needsEntry: boolean;
  /** What argument mode would have submitted untouched. */
  args: Record<string, string | number>;
}

/**
 * Whether a field should render as "you still owe me a value": required,
 * already seen, left empty, and not the one being edited right now. Pure so
 * the chip row can ask without reaching for the service singleton.
 */
export function fieldNeedsValue(active: ActiveArgumentMode, idx: number): boolean {
  const arg = active.args[idx];
  if (!arg?.required || hasDeclaredDefault(arg)) return false;
  if (!active.submitRefused && idx === active.currentFieldIdx) return false;
  if (!active.visited.has(arg.name)) return false;
  return (active.values[arg.name] ?? '').trim() === '';
}

/**
 * Owns the search-bar "argument mode" — the Tab-promoted sub-mode where a
 * selected command becomes a chip and its declared arguments are collected
 * inline. On submit the collected values are passed to `executeCommand`
 * under the `arguments` key; dropdown selections are persisted via Rust so
 * the next invocation restores them (other field types restart empty).
 *
 * Declared arguments come from the already-loaded manifest, so no extra IPC
 * is needed to enter the mode — only the defaults-get call hits Rust.
 *
 * Values are stored as strings internally (chip inputs always produce strings);
 * `buildArgumentsPayload` coerces numeric fields to `number` on submit.
 */
export class CommandArgumentsService {
  private _active = $state<ActiveArgumentMode | null>(null);

  /**
   * Values entered before an Escape, tagged with the result row they were
   * typed against. Restored on the next `enter()` for that row and shown in
   * its hint chips, so an accidental exit doesn't lose partial input. Never
   * persisted, and dropped as soon as the highlight moves.
   */
  private _stash = $state<{
    commandObjectId: string;
    values: Record<string, string>;
    /**
     * Fields that were flagged in place when the user left. Escape hands the
     * caret back to the query the same way Tab does, so a field already
     * marked as owing a value goes on saying so in the hint chips. Only what
     * was actually showing: leaving a field alone is not a complaint about it.
     */
    flagged: ReadonlySet<string>;
  } | null>(null);

  /** Query the current session was entered under. Starts at the empty
   *  launcher query so the first keystroke is a change, not a baseline. */
  private _query = '';

  /**
   * Set when the user presses Enter on a form that cannot run yet. Held
   * rather than derived so nothing is said until they have actually tried,
   * and cleared by the next edit.
   */
  private _blockedNotice = $state<string | null>(null);

  constructor(private readonly deps: CommandArgumentsServiceDeps) {}

  get active(): ActiveArgumentMode | null {
    return this._active;
  }

  stashFor(commandObjectId: string): Record<string, string> | null {
    return this._stash?.commandObjectId === commandObjectId ? this._stash.values : null;
  }

  /** Fields the row's hint chips should still be flagging. */
  flaggedFor(commandObjectId: string): ReadonlySet<string> {
    return this._stash?.commandObjectId === commandObjectId ? this._stash.flagged : EMPTY_FLAGGED;
  }

  private dropStash(commandObjectId: string): void {
    if (this._stash?.commandObjectId === commandObjectId) this._stash = null;
  }

  /**
   * Moving the highlight to another row throws the stash away. A null id
   * (results mid-refresh, nothing highlighted) is not a move and is ignored.
   */
  dropStashUnless(commandObjectId: string | null): void {
    if (!commandObjectId) return;
    if (this._stash && this._stash.commandObjectId !== commandObjectId) this._stash = null;
  }

  /**
   * Report which result row is highlighted. Argument entry describes the row
   * it was started from, so arrowing off that row ends it — left running, the
   * chips would go on collecting values for a command that is no longer
   * selected, and Enter would run that one instead of the highlighted one.
   * The row's stash goes with it, same as any other move of the highlight.
   */
  syncSelection(commandObjectId: string | null): void {
    if (!commandObjectId) return;
    if (this._active && this._active.commandObjectId !== commandObjectId) this.exit();
    this.dropStashUnless(commandObjectId);
  }

  /**
   * Abandon argument entry outright, keeping nothing back for a later
   * resume. Editing the query does this: the chips describe the command the
   * old query selected, so they cannot outlive it.
   */
  reset(): void {
    this._active = null;
    this._stash = null;
    this._blockedNotice = null;
  }

  /**
   * Report the launcher's current query. Any change to it abandons argument
   * entry. Callers pass the value rather than reacting to input events,
   * because the launcher also clears the query programmatically (see
   * `resetLauncherState`) and those assignments fire no input event.
   */
  syncQuery(query: string): void {
    if (this._query === query) return;
    this._query = query;
    this.reset();
  }

  /**
   * Enter on a command whose stash is showing in its hint chips: run it with
   * those values, with no interactive stop. Leaves the user in argument mode
   * instead when a required field is still missing.
   */
  async runWithStash(commandObjectId: string): Promise<boolean> {
    if (!this.stashFor(commandObjectId)) return false;
    const ok = await this.enter(commandObjectId);
    if (!ok) return false;
    await this.submit();
    return true;
  }

  /** Last-used values Rust has for this command, or none if the read fails. */
  private async loadPersisted(meta: CommandArgMeta): Promise<Record<string, string>> {
    const persistenceKey = persistenceCommandKey(meta.commandId, meta.isDynamic === true);
    try {
      return (await commandArgDefaultsGet(meta.extensionId, persistenceKey)) ?? {};
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to load defaults for ${meta.extensionId}/${persistenceKey}: ${err}`,
      );
      return {};
    }
  }

  /**
   * Settle Enter on a command: whether it has to stop and collect input, and
   * what it runs with if it doesn't. Only a required argument with nothing to
   * stand in for it stops it — optional ones never block, and Tab stays the
   * way to fill them in. A declared default, a persisted last selection, or
   * an entry stashed by an earlier Escape all count as a value, and all of
   * them travel with the command when it runs, so firing it straight away
   * sends what the chips would have shown.
   */
  async prepareRun(commandObjectId: string, meta: CommandArgMeta): Promise<PreparedRun> {
    // Only dropdowns are persisted, so nothing else can be waiting in storage
    // — and the read is IPC, so it stays off commands that cannot use it.
    const persisted = meta.args.some((arg) => arg.type === 'dropdown')
      ? await this.loadPersisted(meta)
      : {};
    const stash = this.stashFor(commandObjectId) ?? {};
    const values = {
      ...seedArgumentValues(meta.args, persisted),
      ...stash,
    };
    // Declared defaults are deliberately absent here: they fill blanks in the
    // payload, but they are not the user asking for anything.
    const userValues: Record<string, string> = {};
    for (const arg of meta.args) {
      const supplied = stash[arg.name] ?? persisted[arg.name];
      if (supplied !== undefined && supplied.trim() !== '') userValues[arg.name] = supplied;
    }
    return {
      needsEntry:
        unfilledRequiredArgs(meta.args, values).length > 0 ||
        requireAnyOfUnsatisfied(meta.requireAnyOf, userValues),
      args: buildArgumentsPayload(meta.args, values),
    };
  }

  /**
   * Promote a command into argument mode. Loads declared arguments from the
   * manifest and pre-fills with persisted last values (or declared defaults).
   * Returns false if the command can't be resolved or has no arguments.
   */
  async enter(commandObjectId: string): Promise<boolean> {
    const meta = await this.deps.getManifestByCommandObjectId(commandObjectId);
    if (!meta) {
      logService.debug(`[CommandArgumentsService] enter(${commandObjectId}) — manifest not found`);
      return false;
    }
    if (!meta.args.length) {
      return false;
    }

    const persisted = await this.loadPersisted(meta);
    const values = seedArgumentValues(meta.args, persisted);
    const seeds = { ...values };
    // A remembered selection is the user's earlier pick, so it counts towards
    // `requireAnyOf` the way a fresh one would. A declared default does not.
    const seededFromUser = new Set(
      meta.args.filter((arg) => (persisted[arg.name] ?? '').trim() !== '').map((arg) => arg.name),
    );

    // Values from a prior Escape win over persisted/default seeds so the
    // user resumes exactly where they left off, cleared fields included.
    const edited = new Set<string>();
    const stashed = this.stashFor(commandObjectId);
    if (stashed) {
      for (const arg of meta.args) {
        if (stashed[arg.name] === undefined) continue;
        values[arg.name] = stashed[arg.name];
        edited.add(arg.name);
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
      seeds,
      requireAnyOf: meta.requireAnyOf,
      seededFromUser,
      edited,
      // Field 0 takes focus on entry, so it counts as seen from the start.
      visited: new Set(meta.args.length ? [meta.args[0].name] : []),
      currentFieldIdx: 0,
      submitRefused: false,
      mode: meta.mode,
    };
    return true;
  }

  exit(): void {
    this._blockedNotice = null;
    if (this._active) {
      const active = this._active;
      const { commandObjectId, args, values, edited } = active;
      // Only what the user touched is worth resuming. Passwords stay out
      // regardless: they are never pre-filled.
      const keep: Record<string, string> = {};
      for (const arg of args) {
        if (arg.type === 'password') continue;
        if (!edited.has(arg.name)) continue;
        keep[arg.name] = values[arg.name] ?? '';
      }
      const flagged = new Set(
        args.filter((_, idx) => fieldNeedsValue(active, idx)).map((arg) => arg.name),
      );
      if (Object.values(keep).some((v) => v.trim() !== '') || flagged.size) {
        this._stash = { commandObjectId, values: keep, flagged };
      } else {
        // Nothing entered and nothing outstanding: forget the old stash too.
        this.dropStash(commandObjectId);
      }
    }
    this._active = null;
  }

  setValue(name: string, value: string): void {
    if (!this._active) return;
    // Picking the value a field was already seeded with is still the user
    // making it theirs, so an untouched field falls through to be marked.
    if (this._active.values[name] === value && this._active.edited.has(name)) return;
    // Any edit is an attempt to fix things: drop the stale complaint.
    this._blockedNotice = null;
    this._active = {
      ...this._active,
      values: { ...this._active.values, [name]: value },
      edited: new Set(this._active.edited).add(name),
      submitRefused: false,
    };
  }

  /**
   * Put a field back to what `enter()` seeded it with, and forget that the
   * user touched it. A dropdown arrowed past its first option lands here, and
   * reads as the greyed default again rather than as a deliberate pick.
   */
  resetValue(name: string): void {
    const active = this._active;
    if (!active) return;
    const seeded = active.seeds[name] ?? '';
    if (!active.edited.has(name) && active.values[name] === seeded) return;
    const edited = new Set(active.edited);
    edited.delete(name);
    this._blockedNotice = null;
    this._active = {
      ...active,
      values: { ...active.values, [name]: seeded },
      edited,
      submitRefused: false,
    };
  }

  focusField(idx: number): void {
    if (!this._active) return;
    const max = this._active.args.length - 1;
    const clamped = Math.max(0, Math.min(idx, max));
    if (this._active.currentFieldIdx === clamped) return;
    const arriving = this._active.args[clamped]?.name;
    this._active = {
      ...this._active,
      currentFieldIdx: clamped,
      visited: arriving ? new Set(this._active.visited).add(arriving) : this._active.visited,
    };
  }

  /**
   * Focus has gone back to the search query, so no field is being edited.
   * Separate from `focusField`, which clamps into the row: the query is the
   * slot on either side of the chips, and landing there is what turns "the
   * field I am in" into "a required field I walked away from".
   */
  blurFields(): void {
    if (!this._active || this._active.currentFieldIdx === -1) return;
    this._active = { ...this._active, currentFieldIdx: -1 };
  }

  /**
   * Step one field along. Neither end wraps: the search query sits outside
   * this service on both sides of the row, so the chip row closes the ring
   * itself rather than looping within the fields.
   */
  next(): void {
    if (!this._active) return;
    this.focusField(this._active.currentFieldIdx + 1);
  }

  prev(): void {
    if (!this._active) return;
    this.focusField(this._active.currentFieldIdx - 1);
  }

  /**
   * What the feedback bar should say. A value that cannot be parsed is
   * reported as soon as it is typed; a merely unfilled required field only
   * after the user has tried to run, since until then they have not done
   * anything wrong.
   */
  feedbackMessage(): string | null {
    return this.validationError() ?? this._blockedNotice;
  }

  /**
   * A field the user has filled in wrongly, phrased for the feedback bar.
   * Null while every entered value parses — including when a required field
   * is still empty, which is not an error until Enter is pressed.
   */
  validationError(): string | null {
    if (!this._active) return null;
    for (const arg of this._active.args) {
      const raw = (this._active.values[arg.name] ?? '').trim();
      if (arg.type === 'number' && raw && !Number.isFinite(Number(raw))) {
        return `${arg.placeholder?.trim() || arg.name} must be a number`;
      }
    }
    return null;
  }

  /**
   * Names the first argument still owed a value. Naming it beats a generic
   * "fill the required fields" when a command declares three of them.
   */
  private missingArgumentNotice(): string {
    const active = this._active;
    const missing = active ? unfilledRequiredArgs(active.args, active.values)[0] : undefined;
    const label = missing ? missing.placeholder?.trim() || missing.name : null;
    if (label) return `Value is missing in argument ${label}`;
    // No single field is at fault — the command needs one of several, and
    // naming them all is the only honest way to say what is missing.
    if (active && requireAnyOfUnsatisfied(active.requireAnyOf, userSuppliedValues(active))) {
      const labels = active
        .requireAnyOf!.map((name) => {
          const arg = active.args.find((a) => a.name === name);
          return arg?.placeholder?.trim() || name;
        })
        .join(', ');
      return `Enter at least one of ${labels}`;
    }
    return 'Fill required fields';
  }

  canSubmit(): boolean {
    const active = this._active;
    if (!active) return false;
    if (this.validationError()) return false;
    if (unfilledRequiredArgs(active.args, active.values).length > 0) return false;
    return !requireAnyOfUnsatisfied(active.requireAnyOf, userSuppliedValues(active));
  }

  async submit(): Promise<void> {
    if (!this._active) return;
    // The single authority on whether Enter runs. Callers hand every press
    // here rather than pre-checking, so a refusal always has somewhere to say
    // why instead of being swallowed.
    if (!this.canSubmit()) {
      this._blockedNotice = this.validationError() ?? this.missingArgumentNotice();
      // Everything still owed is now something the user has been told about,
      // so it may flag itself in place once focus moves off it.
      this._active = {
        ...this._active,
        visited: new Set(this._active.args.map((arg) => arg.name)),
        submitRefused: true,
      };
      logService.debug(`[argumentMode] submit refused: ${this._blockedNotice}`);
      return;
    }
    this._blockedNotice = null;

    const active = this._active;
    const payload = buildArgumentsPayload(active.args, active.values);

    // Persist non-password values BEFORE executing — the command may navigate
    // away or close the launcher, and we want the user's input preserved.
    const persist: Record<string, string> = {};
    for (const arg of active.args) {
      // Only dropdown selections survive across invocations, because a
      // select needs a concrete value next time. Text and number inputs
      // restart empty with their hint showing.
      if (arg.type !== 'dropdown') continue;
      const raw = (active.values[arg.name] ?? '').trim();
      if (!raw) continue;
      persist[arg.name] = raw;
    }
    const persistKey = persistenceCommandKey(active.commandId, active.isDynamic);
    try {
      await commandArgDefaultsSet(active.extensionId, persistKey, persist);
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to persist defaults for ${active.extensionId}/${persistKey}: ${err}`,
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
        commandObjectId: active.commandObjectId,
        args: payload,
        mode: active.mode ?? 'view',
      });
    }

    // Only clear the mode if the command executed without throwing. If it
    // threw, the user likely wants their inputs preserved so they can retry.
    this.dropStash(active.commandObjectId);
    if (this._active === active) this._active = null;
  }
}
