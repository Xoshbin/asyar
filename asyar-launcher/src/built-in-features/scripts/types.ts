import type { CommandArgument } from 'asyar-sdk/contracts';

/**
 * Execution mode declared by `# @asyar.mode <value>` in a script header.
 * Mirrors Raycast's `mode` directive. `compact` is the default when the
 * directive is absent. Only `inline` is fully wired today; the rest are
 * accepted-and-stored for forward compatibility with the rest of Raycast's
 * mode taxonomy.
 */
export type ScriptMode = 'silent' | 'compact' | 'fullOutput' | 'inline';

export interface ParsedScriptHeader {
  title: string | null;
  icon: string | null;
  arguments: CommandArgument[];
  mode: ScriptMode;
  /** Already clamped to the 10s floor by the Rust parser. */
  refreshTimeSeconds: number | null;
  /** True iff the declared refreshTime was below 10s and got clamped. */
  refreshTimeClamped: boolean;
}

export interface ScannedScript {
  absolutePath: string;
  directoryPath: string;
  fileName: string;
  displayName: string;
  dynamicId: string;
  header: ParsedScriptHeader;
  executable: boolean;
}

export type ScriptScanIssueReason =
  | 'directoryUnreadable'
  | 'metadataUnreadable'
  | 'pathUnavailable'
  | 'notExecutable'
  | 'contentUnreadable'
  | 'invalidHeader';

export type ScriptScanIssueFix = 'makeExecutable';

export interface ScriptScanIssue {
  absolutePath: string;
  directoryPath: string;
  fileName: string;
  reason: ScriptScanIssueReason;
  message: string;
  fix: ScriptScanIssueFix | null;
}

export interface ScriptScanReport {
  scripts: ScannedScript[];
  issues: ScriptScanIssue[];
}
