import { Command } from '@tauri-apps/plugin-shell';
import { openPath } from '@tauri-apps/plugin-opener';
import { platform } from '@tauri-apps/plugin-os';
import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';

export type TerminalCommand = { program: string; args: string[] } | { fallback: true };

/** POSIX single-quote escape: wraps `s` in single-quotes, handling embedded single-quotes. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** AppleScript double-quote escape: wraps `s` in double-quotes, escaping backslashes and double-quotes. */
function asq(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Builds a terminal launch command for the given platform.
 *
 * Only programs from the Tauri shell plugin allowlist are used as `program`:
 *   - macOS/Linux: `/bin/sh`
 *   - Windows: `cmd.exe`
 *
 * @param plat - Platform string as returned by `@tauri-apps/plugin-os` `platform()`.
 * @param dir  - Absolute path to cd into before running `command`.
 * @param command - Shell command to run in the new terminal window.
 */
export function buildTerminalCommand(plat: string, dir: string, command: string): TerminalCommand {
  switch (plat) {
    case 'macos': {
      const inner = `cd ${shq(dir)} && ${command}`;
      const doScript = `tell application "Terminal" to do script ${asq(inner)}`;
      const activate = `tell application "Terminal" to activate`;
      const script = `osascript -e ${shq(doScript)} -e ${shq(activate)}`;
      return { program: '/bin/sh', args: ['-c', script] };
    }
    case 'linux': {
      const inner = `cd ${shq(dir)} && ${command}; exec bash`;
      const q = shq(inner);
      const script =
        `gnome-terminal -- bash -c ${q} || x-terminal-emulator -e bash -c ${q} || xterm -e bash -c ${q}`;
      return { program: '/bin/sh', args: ['-c', script] };
    }
    case 'windows': {
      // cmd.exe quoting is unreliable for metacharacters; fail closed if the path
      // contains any (not valid in real Windows paths anyway) and fall back.
      if (/[\r\n&|<>^"%]/.test(dir)) return { fallback: true };
      return { program: 'cmd.exe', args: ['/c', 'start', 'cmd', '/k', `cd /d "${dir}" && ${command}`] };
    }
    default:
      return { fallback: true };
  }
}

/**
 * Opens a terminal window at `dir` and runs `command` in it.
 *
 * Falls back to opening the directory in the OS file manager when the platform
 * is not recognised or the shell invocation fails, and surfaces a manual-action
 * diagnostic so the user knows what to run.
 */
export async function openTerminalAt(dir: string, command: string): Promise<void> {
  const tc = buildTerminalCommand(platform(), dir, command);
  if ('fallback' in tc) {
    await openPath(dir).catch(() => {});
    await diagnosticsService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'info',
      retryable: false,
      context: { message: `Open a terminal in ${dir} and run: ${command}` },
    });
    return;
  }
  try {
    await Command.create(tc.program, tc.args).execute();
  } catch {
    await openPath(dir).catch(() => {});
    await diagnosticsService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'warning',
      retryable: false,
      context: { message: `Couldn't open a terminal. Run "${command}" in ${dir}.` },
    });
  }
}
