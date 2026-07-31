// asyar-launcher/src/lib/ipc/scriptCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';
import { bumpArgumentHintVersion } from '../launcher/argumentHintVersion.svelte';

// ── Scripts ───────────────────────────────────────────────────────────────────

export async function scriptsAddDirectory(path: string): Promise<void> {
  await invokeSafe('scripts_add_directory', { path });
}

export async function scriptsRemoveDirectory(path: string): Promise<void> {
  await invokeSafe('scripts_remove_directory', { path });
}

export async function scriptsListDirectories(): Promise<string[] | null> {
  return invokeSafe<string[]>('scripts_list_directories');
}

export async function scriptsPickDirectory(): Promise<string | null> {
  return invokeSafe<string | null>('scripts_pick_directory');
}

export async function scriptsRescan(): Promise<
  import('../../built-in-features/scripts/types').ScriptScanReport | null
> {
  return invokeSafe('scripts_rescan');
}

export async function scriptsMakeExecutable(path: string): Promise<void> {
  await invokeSafe('scripts_make_executable', { path });
}

/**
 * Per-tick payload emitted by the Rust inline-script scheduler over the
 * Tauri event `scripts:inline:tick`. The TS scriptsManager listens for
 * this and writes `subtitle` into `commandService.liveSubtitles` so the
 * row's subtitle refreshes in place.
 */
export interface InlineTickPayload {
  dynamicId: string;
  subtitle: string | null;
  error: string | null;
}

/**
 * One inline-mode script spec passed to `scriptsSetInlineScripts`. Mirrors
 * the Rust `InlineScriptSpec`.
 */
export interface InlineScriptSpec {
  dynamicId: string;
  absolutePath: string;
  refreshTimeSeconds: number;
}

/**
 * Outcome shape returned by `scriptsSetInlineScripts`. `capped` is the
 * overflow above the 10-script Raycast cap; `dropped` is the set of
 * dynamic ids whose tasks were aborted (file removed, mode changed away
 * from inline, or moved into the capped overflow).
 */
export interface SetInlineScriptsOutcome {
  accepted: string[];
  capped: string[];
  dropped: string[];
}

/**
 * Replace the active inline-mode tick set. Cap policy + diff is owned by
 * Rust; the TS side passes the full current list of inline specs on every
 * rescan and reads back what was actually scheduled.
 */
export async function scriptsSetInlineScripts(
  specs: InlineScriptSpec[],
): Promise<SetInlineScriptsOutcome | null> {
  return invokeSafe('scripts_set_inline_scripts', { specs });
}

export async function replaceDynamicCommandsBuiltin(
  extensionId: string,
  regs: import('asyar-sdk/contracts').DynamicCommandRegistration[],
): Promise<void> {
  await invokeSafe('replace_dynamic_commands_builtin', { extensionId, regs });
  bumpArgumentHintVersion();
}
