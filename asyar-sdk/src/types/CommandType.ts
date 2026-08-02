/**
 * Command argument types — declared in manifest.json per command.
 * Max 3 arguments per command. Required args must precede optional args.
 */
export type CommandArgumentType = 'text' | 'password' | 'dropdown' | 'number';

export interface CommandArgumentDropdownOption {
  value: string;
  title: string;
}

/**
 * Where a chip's starting value comes from, independent of whether the command
 * is gated. `"lastUsed"` falls back to `default`, then to empty, so it is the
 * sensible value when nothing is declared.
 */
export type ArgumentSeed = 'none' | 'default' | 'lastUsed';

export interface CommandArgument {
  name: string;
  type: CommandArgumentType;
  placeholder?: string;
  required?: boolean;
  default?: string | number;
  data?: CommandArgumentDropdownOption[];
  /**
   * Starting value for the chip. Omitted means `"lastUsed"` — except on
   * `password`, which is always `"none"` and may declare neither a `default`
   * nor `"lastUsed"`. Use `"none"` for one-off input that should not be
   * remembered.
   */
  seed?: ArgumentSeed;
}

/**
 * The shape of args delivered to a command's execute() handler.
 * User-declared argument values live under `arguments`, separate from
 * system flags (`scheduledTick`, `deeplinkTrigger`) so the two never
 * collide.
 */
export interface CommandExecuteArgs {
  arguments?: Record<string, string | number>;
  scheduledTick?: boolean;
  deeplinkTrigger?: boolean;
  [key: string]: unknown;
}

export interface CommandHandler {
  execute: (args?: CommandExecuteArgs) => Promise<unknown> | unknown;
}

/**
 * Runtime-registered command. Behaves identically to a manifest-declared
 * command at every layer below registration: search ranking, argument-mode
 * Tab promotion, dispatcher routing, last-value persistence.
 *
 * Registered from a Tier 2 extension's worker iframe via
 * `commandsService.replaceDynamicCommands(regs)`. The full current list
 * is the only thing the extension can declare — there is no incremental
 * register/unregister. The launcher diffs internally and garbage-collects
 * persistence rows for removed commands.
 *
 * Stable id is the persistence key. If the underlying source can be
 * renamed (e.g. an Apple Shortcut), the id MUST NOT change with the
 * rename — prefer UUIDs from the underlying system.
 */
export interface DynamicCommandRegistration {
  /** Stable identifier. Must match `/^[a-zA-Z0-9_-]+$/`, max 128 chars. */
  id: string;
  /** Display title in search results. */
  name: string;
  /** Optional subtitle for the search-result row. */
  description?: string;
  /** Icon reference (e.g. `"icon:link"` or an emoji). */
  icon?: string;
  /**
   * Right-side row label in root search, e.g. "Apple Shortcut" for a
   * single shortcut item. Defaults to the extension's display name.
   */
  typeLabel?: string;
  /**
   * Optional argument schema. Same rules as manifest arguments:
   * max 3 entries, required must precede optional, dropdowns need
   * non-empty `data[]`, `default` must type-match.
   */
  arguments?: CommandArgument[];
  /**
   * Argument names of which at least one must carry a user value before the
   * command runs. Use when a command needs SOME input but no single argument
   * can be `required` — `caffeinate-for` wants hours, minutes or seconds and
   * does not mind which. Needs two or more names, none of them `required`.
   */
  requireAnyOf?: string[];
}
