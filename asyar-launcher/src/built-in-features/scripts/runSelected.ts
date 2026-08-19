import { scriptsManager } from './scriptsManager.svelte';
import { dispatchScriptCommand } from './dispatch';
import { commandArgumentsService } from '../../services/search/commandArguments';

/** Run whatever the script library has selected, prompting for arguments
 *  first when the script declares any. Lives outside index.ts so the view
 *  can share it — index.ts imports the view, so the view cannot import back. */
export async function runSelectedScript(): Promise<void> {
  const script = scriptsManager.selectedScript;
  if (!script) return;
  if (script.header.arguments.length > 0) {
    const entered = await commandArgumentsService.enter(`cmd_scripts_dyn_${script.dynamicId}`);
    if (entered) return;
  }
  await dispatchScriptCommand(script.dynamicId, undefined);
}
