/**
 * Command argument types — declared in manifest.json per command.
 * Max 3 arguments per command. Required args must precede optional args.
 */
export type CommandArgumentType = "text" | "password" | "dropdown" | "number";

export interface CommandArgumentDropdownOption {
  value: string;
  title: string;
}

export interface CommandArgument {
  name: string;
  type: CommandArgumentType;
  placeholder?: string;
  required?: boolean;
  default?: string | number;
  data?: CommandArgumentDropdownOption[];
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
