export interface CommandArgument {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description?: string;
  required?: boolean;
  default?: any;
}

export interface CommandDefinition {
  id: string;
  name: string;
  description: string;
  trigger: string;
  arguments?: CommandArgument[];
}

export interface CommandHandler {
  execute: (args?: Record<string, any>) => Promise<void> | void;
}
