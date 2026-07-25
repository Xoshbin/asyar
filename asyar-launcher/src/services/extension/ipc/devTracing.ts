import { developerSettingsService } from '../../settings/developerSettingsService.svelte';

/**
 * Dev-inspector frames route to the inspector store only when developer mode
 * AND tracing are both on; a dev build forces both. When this is false the
 * frames fall through the pipeline into the unknown-`asyar:*` bucket.
 */
export function isDevInspectorActive(): boolean {
  const devActive = import.meta.env.DEV || developerSettingsService.isDeveloperMode;
  const tracingEnabled = import.meta.env.DEV || developerSettingsService.tracing;
  return devActive && tracingEnabled;
}
