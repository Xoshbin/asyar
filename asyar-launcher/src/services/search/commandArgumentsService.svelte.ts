import type { CommandArgument } from 'asyar-sdk/contracts';
import { logService } from '../log/logService';
import {
  commandArgDefaultsGet,
  commandArgDefaultsSet,
} from '../../lib/ipc/commandArgDefaultsCommands';
import { resolveCommandArguments } from '../../lib/ipc/argumentModelCommands';
import type { ArgumentModelResolution } from '../../lib/ipc/argumentModelCommands';

export interface CommandArgMeta {
  extensionId: string;
  /**
   * The bare command identifier — used for the dispatch payload that
   * reaches the extension's `executeCommand(commandId, args)`. For
   * dynamic commands this is the dynamic id as the extension
   * registered it; the `dynamic:` storage prefix is applied server-side
   * by `command_arg_defaults_get`/`_set` when `isDynamic` is true.
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
   * Fields that have been selected at some point this invocation. Selection
   * is agreement: a required field holding a seeded value counts as filled
   * once the user has stood in it. Fed only by real focus, never by a
   * refused submit.
   */
  confirmed: ReadonlySet<string>;
  /**
   * Required fields the user has walked away from empty, plus everything a
   * refused Enter named. Membership is permanent; the red shows whenever the
   * field is empty on screen, focused or not.
   */
  owed: ReadonlySet<string>;
  /**
   * The field being edited, or -1 when focus sits in the search query. The
   * query is a slot on either side of the row, so "no field" is a real
   * position in the walk rather than an absent one.
   */
  currentFieldIdx: number;
  /**
   * An Enter was refused while `requireAnyOf` was unmet, or focus left the
   * group with every member visited and none filled. Never reset: the
   * marking clears by satisfying the gate, not by typing elsewhere.
   */
  anyOfRefused: boolean;
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
  /**
   * The Rust-computed argument model for the current `values`/`edited`/
   * `confirmed` snapshot — provenance, the `required`/`requireAnyOf` gates,
   * and the coerced payload. Refreshed after every mutation; `submit()`
   * additionally resolves fresh right before deciding, since it is the one
   * place a stale-by-one-keystroke answer would matter. See the `rust-first`
   * skill and `extensions::argument_model::resolve` in the Rust crate — this
   * mirrors the `has_arguments`/`type_label` precomputed-field pattern used
   * for search results, needed because `fieldNeedsAnyOf` reads it
   * synchronously during Svelte's render pass, where IPC cannot be awaited.
   */
  resolved: ArgumentModelResolution;
}

const EMPTY_FLAGGED: ReadonlySet<string> = new Set();

/** "A or B" for two, "A, B, or C" beyond: the bar's either-list copy. */
function eitherList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
}

/** What Enter on a command should do, and what it should run with. */
export interface PreparedRun {
  /** A required argument has nothing to stand in for it: collect input first. */
  needsEntry: boolean;
  /** What argument mode would have submitted untouched. */
  args: Record<string, string | number>;
}

/**
 * Whether a field should render as "you still owe me a value": required,
 * in `owed`, and empty on screen. A field showing an unagreed seed stays
 * dashed instead — it is not missing anything the user can see. Pure so the
 * chip row can ask without reaching for the service singleton.
 */
export function fieldNeedsValue(active: ActiveArgumentMode, idx: number): boolean {
  const arg = active.args[idx];
  if (!arg?.required) return false;
  if (!active.owed.has(arg.name)) return false;
  return (active.values[arg.name] ?? '').trim() === '';
}

/**
 * Whether a field should render as part of an unmet `requireAnyOf` group:
 * the user has been told (`anyOfRefused`), the gate is still unmet, and this
 * field is a member. Clears for the whole group the moment any member holds
 * a user value. A field individually owed a value keeps its own, stronger
 * marking instead.
 *
 * `requireAnyOfUnsatisfied` itself is computed in Rust
 * (`extensions::argument_model::resolve`) — this reads the last-resolved
 * answer off `active.resolved` rather than recomputing it, because Svelte's
 * render pass calling this (once per chip, every render) cannot await IPC.
 */
export function fieldNeedsAnyOf(active: ActiveArgumentMode, idx: number): boolean {
  const arg = active.args[idx];
  if (!arg || !active.requireAnyOf?.includes(arg.name)) return false;
  if (!active.anyOfRefused) return false;
  if (fieldNeedsValue(active, idx)) return false;
  return active.resolved.requireAnyOfUnsatisfied;
}

/**
 * Field names to send as `edited` on a refresh/resolve call that omits
 * `persisted` (every call after `enter()`'s own). Rust's `seededFromUser`
 * is derived from `persisted`, so recomputing it fresh from an empty map
 * would forget which fields were remembered from a previous run. Folding
 * `active.seededFromUser` (computed once, at `enter()`) into `edited` gets
 * the same "counts as the user's" credit without re-sending `persisted` on
 * every keystroke.
 */
function userTouchedFields(active: ActiveArgumentMode): string[] {
  return [...active.edited, ...active.seededFromUser];
}

/**
 * Owns the search-bar "argument mode" — the Tab-promoted sub-mode where a
 * selected command becomes a chip and its declared arguments are collected
 * inline. On submit the collected values are passed to `executeCommand`
 * under the `arguments` key; dropdown selections are persisted via Rust so
 * the next invocation restores them (other field types restart empty).
 *
 * Declared arguments come from the already-loaded manifest, so no extra IPC
 * is needed to enter the mode — only the defaults-get and argument-model-
 * resolve calls hit Rust.
 *
 * Values are stored as strings internally (chip inputs always produce strings);
 * the resolved `payload` coerces numeric fields to `number` on submit.
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

  /**
   * Guards the fire-and-forget refresh kicked off by every mutator against a
   * stale response landing after a newer mutation (or after `exit()`/
   * `enter()` switched commands entirely) — the same shape as a request-id
   * check on any out-of-order async response.
   */
  private resolveGeneration = 0;

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
    try {
      return (
        (await commandArgDefaultsGet(meta.extensionId, meta.commandId, meta.isDynamic === true)) ??
        {}
      );
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to load defaults for ${meta.extensionId}/${meta.commandId}: ${err}`,
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
    const resolved = await resolveCommandArguments({
      args: meta.args,
      persisted,
      values: stash,
      edited: Object.keys(stash),
      requireAnyOf: meta.requireAnyOf,
    });
    return {
      needsEntry: resolved.unfilledRequired.length > 0 || resolved.requireAnyOfUnsatisfied,
      args: resolved.payload,
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
    const stashed = this.stashFor(commandObjectId) ?? {};
    // Field 0 takes focus on entry, and selection is agreement, so its seed
    // counts as accepted from the start.
    const confirmedInitial = [meta.args[0].name];

    const resolved = await resolveCommandArguments({
      args: meta.args,
      persisted,
      values: stashed,
      edited: Object.keys(stashed),
      confirmed: confirmedInitial,
      requireAnyOf: meta.requireAnyOf,
    });

    // Values from a prior Escape win over persisted/default seeds so the
    // user resumes exactly where they left off, cleared fields included.
    const values = { ...resolved.seeds, ...stashed };

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
      seeds: resolved.seeds,
      requireAnyOf: meta.requireAnyOf,
      seededFromUser: new Set(resolved.seededFromUser),
      edited: new Set(Object.keys(stashed)),
      confirmed: new Set(confirmedInitial),
      owed: new Set<string>(),
      currentFieldIdx: 0,
      anyOfRefused: false,
      mode: meta.mode,
      resolved,
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
    };
    this.refreshResolved();
  }

  /**
   * Put a field back to what `enter()` seeded it with, and forget that the
   * user touched it. A dropdown arrowed past its first option lands here, and
   * reads as the greyed default again rather than as a deliberate pick. A
   * remembered value loses its user provenance too: an explicit reset says
   * "not mine this run", so it stops counting for `requireAnyOf` and greys
   * back to a suggestion.
   */
  resetValue(name: string): void {
    const active = this._active;
    if (!active) return;
    const seeded = active.seeds[name] ?? '';
    if (
      !active.edited.has(name) &&
      !active.seededFromUser.has(name) &&
      active.values[name] === seeded
    )
      return;
    const edited = new Set(active.edited);
    edited.delete(name);
    const seededFromUser = new Set(active.seededFromUser);
    seededFromUser.delete(name);
    this._blockedNotice = null;
    this._active = {
      ...active,
      values: { ...active.values, [name]: seeded },
      edited,
      seededFromUser,
    };
    this.refreshResolved();
  }

  /**
   * Whether moving focus to `destIdx` (-1 for the query) walks out on a
   * still-unmet `requireAnyOf` group the user has stood in every member of.
   * Gated on `confirmed`: only real focus counts as having seen a field.
   * `requireAnyOfUnsatisfied` is read off the last-resolved cache rather than
   * recomputed — this runs synchronously off a real focus event, and IPC
   * cannot be awaited there.
   */
  private leavesAnyOfUnmet(active: ActiveArgumentMode, destIdx: number): boolean {
    const group = active.requireAnyOf;
    if (!group?.length || active.anyOfRefused) return false;
    const dest = destIdx === -1 ? undefined : active.args[destIdx]?.name;
    if (dest && group.includes(dest)) return false;
    if (!group.every((name) => active.confirmed.has(name))) return false;
    return active.resolved.requireAnyOfUnsatisfied;
  }

  /**
   * `owed` after focus leaves the current field: leaving a required field
   * empty on screen is what earns the marking. Escape never lands here,
   * `exit()` runs before the query regains focus.
   */
  private owedAfterLeaving(active: ActiveArgumentMode): ReadonlySet<string> {
    const departing =
      active.currentFieldIdx === -1 ? undefined : active.args[active.currentFieldIdx];
    if (!departing?.required || active.owed.has(departing.name)) return active.owed;
    if ((active.values[departing.name] ?? '').trim() !== '') return active.owed;
    return new Set(active.owed).add(departing.name);
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
      confirmed: arriving ? new Set(this._active.confirmed).add(arriving) : this._active.confirmed,
      owed: this.owedAfterLeaving(this._active),
      anyOfRefused: this._active.anyOfRefused || this.leavesAnyOfUnmet(this._active, clamped),
    };
    this.refreshResolved();
  }

  /**
   * Focus has gone back to the search query, so no field is being edited.
   * Separate from `focusField`, which clamps into the row: the query is the
   * slot on either side of the chips, and landing there is what turns "the
   * field I am in" into "a required field I walked away from".
   */
  blurFields(): void {
    if (!this._active || this._active.currentFieldIdx === -1) return;
    this._active = {
      ...this._active,
      currentFieldIdx: -1,
      owed: this.owedAfterLeaving(this._active),
      anyOfRefused: this._active.anyOfRefused || this.leavesAnyOfUnmet(this._active, -1),
    };
    this.refreshResolved();
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
   * Apply a resolution to `_active.resolved`, but only if nothing has
   * superseded it: a later call bumped `resolveGeneration` past ours, or
   * the session moved on to a different command (or closed) entirely.
   * Comparing `commandObjectId` rather than object identity matters because
   * `_active` is legitimately replaced on every mutation (and by another
   * resolve landing) — reference equality would treat every one of those as
   * "the session changed" and drop good data, which is exactly the race
   * this method exists to avoid.
   */
  private applyResolved(
    commandObjectId: string,
    generation: number,
    resolved: ArgumentModelResolution,
  ): void {
    if (this.resolveGeneration !== generation) return;
    if (!this._active || this._active.commandObjectId !== commandObjectId) return;
    this._active = { ...this._active, resolved };
  }

  /**
   * Re-resolve the argument model for the current `values`/`edited`/
   * `confirmed` snapshot and cache the answer on `_active.resolved`. Fired
   * after every mutation; not awaited by the caller — `fieldNeedsAnyOf`
   * reads whatever is cached, and `submit()`/`canSubmit()` resolve fresh
   * themselves rather than trust this cache, so a keystroke's worth of
   * staleness here only ever affects paint, never the run/refuse decision.
   */
  private refreshResolved(): void {
    if (!this._active) return;
    const active = this._active;
    const generation = ++this.resolveGeneration;
    resolveCommandArguments({
      args: active.args,
      values: active.values,
      edited: userTouchedFields(active),
      confirmed: [...active.confirmed],
      requireAnyOf: active.requireAnyOf,
    })
      .then((resolved) => this.applyResolved(active.commandObjectId, generation, resolved))
      .catch((err) => {
        logService.warn(`[CommandArgumentsService] Failed to refresh argument model: ${err}`);
      });
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
   * One compact line naming everything still owed, in declaration order: a
   * plain item is a required field that is empty on screen, an or-list is
   * the unmet `requireAnyOf` group. The chips carry the pointing; the bar
   * just enumerates. A required field holding an unconfirmed seed is not
   * listed — it is not empty, and the Enter walk is what settles it.
   */
  private missingArgumentNotice(resolved: ArgumentModelResolution): string {
    const active = this._active;
    if (!active) return 'Fill required fields';
    const items: Array<{ idx: number; text: string }> = [];
    for (const name of resolved.unfilledRequiredVisible) {
      const idx = active.args.findIndex((a) => a.name === name);
      const arg = active.args[idx];
      if (!arg) continue;
      items.push({ idx, text: arg.placeholder?.trim() || arg.name });
    }
    if (resolved.requireAnyOfUnsatisfied && active.requireAnyOf?.length) {
      const group = active.requireAnyOf;
      const labels = group.map((name) => {
        const arg = active.args.find((a) => a.name === name);
        return arg?.placeholder?.trim() || name;
      });
      items.push({
        idx: active.args.findIndex((a) => a.name === group[0]),
        text: eitherList(labels),
      });
    }
    if (!items.length) return 'Fill required fields';
    items.sort((a, b) => a.idx - b.idx);
    // Two spaces after the label, which BottomActionBar renders bold: it
    // string-matches this exact "Required  " prefix, so they change together.
    return `Required  ${items.map((i) => i.text).join(' • ')}`;
  }

  /**
   * The field Enter should select instead of running: the first required
   * field holding a seeded value the user has not stood in yet, from a fresh
   * `resolved`. -1 when there is nothing to walk to, or when walking could
   * not end in a run anyway — a genuinely empty required field (still absent
   * from `unfilledRequiredVisible` after crediting acknowledgement) or an
   * unmet `requireAnyOf` needs typing, and selecting seeded fields first
   * would just delay the complaint.
   */
  private confirmWalkTarget(resolved: ArgumentModelResolution): number {
    const active = this._active;
    if (!active || this.validationError() || resolved.requireAnyOfUnsatisfied) return -1;
    const gaps = resolved.unfilledRequiredAcknowledged;
    if (!gaps.length) return -1;
    if (gaps.some((name) => resolved.unfilledRequiredVisible.includes(name))) return -1;
    return active.args.findIndex((arg) => arg.name === gaps[0]);
  }

  /**
   * Resolve fresh against the current `values`/`edited`/`confirmed`
   * snapshot and cache the answer on `_active.resolved`. Unlike
   * `refreshResolved()`, this is awaited by its caller — used by
   * `canSubmit()` and `submit()`, the two places a stale-by-one-keystroke
   * answer would matter rather than just paint. Shares `resolveGeneration`
   * with `refreshResolved()` so a fire-and-forget refresh kicked off just
   * before this call can never win a race against it and overwrite a newer
   * answer with a stale one. Returns `null` if there is no active session,
   * or if a later call (or `exit()`/`enter()`) superseded this one.
   */
  private async resolveFresh(): Promise<ArgumentModelResolution | null> {
    const active = this._active;
    if (!active) return null;
    const generation = ++this.resolveGeneration;
    const resolved = await resolveCommandArguments({
      args: active.args,
      values: active.values,
      edited: userTouchedFields(active),
      confirmed: [...active.confirmed],
      requireAnyOf: active.requireAnyOf,
    });
    if (this.resolveGeneration !== generation) return null;
    if (!this._active || this._active.commandObjectId !== active.commandObjectId) return null;
    this.applyResolved(active.commandObjectId, generation, resolved);
    return resolved;
  }

  /**
   * Whether the currently active command could run right now: every
   * `required` argument is satisfied (a confirmed seed counts, a bare
   * default does not) and `requireAnyOf` (which no seed can satisfy) is
   * met. Resolves fresh every call, same as `submit()` — this is the
   * correctness-critical read, not the cached `active.resolved` that
   * `fieldNeedsAnyOf` paints off.
   */
  async canSubmit(): Promise<boolean> {
    if (!this._active || this.validationError()) return false;
    const resolved = await this.resolveFresh();
    if (!resolved) return false;
    return resolved.unfilledRequiredAcknowledged.length === 0 && !resolved.requireAnyOfUnsatisfied;
  }

  async submit(): Promise<void> {
    if (!this._active) return;
    // The single authority on whether Enter runs. Callers hand every press
    // here rather than pre-checking, so a refusal always has somewhere to say
    // why instead of being swallowed.
    if (this.validationError()) {
      this._blockedNotice = this.validationError();
      return;
    }

    const resolved = await this.resolveFresh();
    // Another enter()/exit() raced this await — nothing left to submit.
    if (!resolved || !this._active) return;
    const active = this._active;

    const canRun =
      resolved.unfilledRequiredAcknowledged.length === 0 && !resolved.requireAnyOfUnsatisfied;

    if (!canRun) {
      // When every gap is a seeded value the user could agree to, Enter
      // walks instead of complaining: selection counts as agreement, so the
      // next Enter moves on, or runs. Nothing is wrong, so nothing turns red.
      const walkIdx = this.confirmWalkTarget(resolved);
      if (walkIdx !== -1) {
        this._blockedNotice = null;
        this.focusField(walkIdx);
        return;
      }
      this._blockedNotice = this.missingArgumentNotice(resolved);
      // Everything still owed is now something the user has been told about,
      // so it may flag itself in place — reached or not.
      this._active = {
        ...this._active,
        owed: new Set([...this._active.owed, ...resolved.unfilledRequiredVisible]),
        anyOfRefused: this._active.anyOfRefused || resolved.requireAnyOfUnsatisfied,
      };
      logService.debug(`[argumentMode] submit refused: ${this._blockedNotice}`);
      return;
    }
    this._blockedNotice = null;

    const payload = resolved.payload;

    // Persist non-password values BEFORE executing — the command may navigate
    // away or close the launcher, and we want the user's input preserved.
    const persist: Record<string, string> = {};
    // Only what the user supplied, and only where the argument asked to be
    // remembered (`lastUsedFields`). Storing a default that merely passed
    // through the chip would make the author's suggestion indistinguishable
    // from a real choice next run, and open a gate that should have stayed
    // shut.
    for (const name of resolved.lastUsedFields) {
      const raw = (resolved.userSupplied[name] ?? '').trim();
      if (!raw) continue;
      persist[name] = raw;
    }
    try {
      await commandArgDefaultsSet(active.extensionId, active.commandId, active.isDynamic, persist);
    } catch (err) {
      logService.warn(
        `[CommandArgumentsService] Failed to persist defaults for ${active.extensionId}/${active.commandId}: ${err}`,
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
