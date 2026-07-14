import { platform } from '@tauri-apps/plugin-os';
import { replaceDynamicCommandsBuiltin, systemActionsSupported } from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import { systemActionSpecs } from './actions';

export const SYSTEM_EXTENSION_ID = 'system';

/**
 * Registers one dynamic command per system action the current machine
 * supports (per `system_actions_supported`), in the backend's display
 * order. Called on feature activation; replaces the previous list, so a
 * machine-level change (e.g. hibernation toggled) is reflected on the
 * next launcher start.
 */
export async function registerSystemCommands(): Promise<void> {
  const supported = await systemActionsSupported();
  const specs = systemActionSpecs(platform());
  const regs = supported
    .map((id) => specs[id])
    .filter((spec) => spec !== undefined)
    .map((spec) => ({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      icon: spec.icon,
    }));
  try {
    await replaceDynamicCommandsBuiltin(SYSTEM_EXTENSION_ID, regs);
  } catch (err) {
    logService.error(`[system] failed to register system commands: ${err}`);
  }
}

export async function unregisterSystemCommands(): Promise<void> {
  try {
    await replaceDynamicCommandsBuiltin(SYSTEM_EXTENSION_ID, []);
  } catch (err) {
    logService.error(`[system] failed to unregister system commands: ${err}`);
  }
}
