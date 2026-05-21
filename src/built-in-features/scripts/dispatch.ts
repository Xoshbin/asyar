import { shellService } from '../../services/shell/shellService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import type { BuiltinDispatchResult } from '../../services/extension/builtinDynamicDispatchers';
import { scriptsManager } from './scriptsManager.svelte';

const SCRIPTS_EXTENSION_ID = 'scripts';

function deriveFilenameTitle(absolutePath: string): string {
  const base = absolutePath.split(/[\\/]/).pop() ?? absolutePath;
  return base.replace(/\.[^.]+$/, '') || base;
}

// Scripts are launched in-app rather than handing off to another window
// (like launching a .app), so the launcher stays open after spawn.
const KEEP_OPEN: BuiltinDispatchResult = { keepLauncherOpen: true };

export async function dispatchScriptCommand(
  dynamicId: string,
  args: Record<string, unknown> | undefined,
): Promise<BuiltinDispatchResult> {
  const script = scriptsManager.getScriptByDynamicId(dynamicId);
  if (!script) {
    diagnosticsService.report({
      kind: 'action_failed',
      severity: 'warning',
      retryable: false,
      source: 'frontend',
      context: { message: `script ${dynamicId} not found` },
    });
    return KEEP_OPEN;
  }

  const argMap =
    (args && typeof args === 'object' && 'arguments' in args
      ? (args as { arguments: Record<string, unknown> }).arguments
      : args) ?? {};

  const argsArray = script.header.arguments.map((argSpec) => {
    const value = (argMap as Record<string, unknown>)[argSpec.name];
    return value !== undefined && value !== null ? String(value) : '';
  });

  const spawnId = crypto.randomUUID();
  const subjectId = `cmd_scripts_dyn_${dynamicId}`;
  const label = script.header.title ?? deriveFilenameTitle(script.absolutePath);
  await shellService.spawn(
    SCRIPTS_EXTENSION_ID,
    script.absolutePath,
    argsArray,
    spawnId,
    undefined,
    subjectId,
    label,
  );

  return KEEP_OPEN;
}
