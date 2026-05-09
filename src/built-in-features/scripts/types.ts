import type { CommandArgument } from 'asyar-sdk/contracts';

export interface ParsedScriptHeader {
  title: string | null;
  icon: string | null;
  arguments: CommandArgument[];
}

export interface ScannedScript {
  absolutePath: string;
  dynamicId: string;
  header: ParsedScriptHeader;
  executable: boolean;
}
