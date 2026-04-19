<script lang="ts">
  import type { ExtensionRecord } from '../../types/ExtensionRecord';
  import { viewManager } from '../../services/extension/viewManager.svelte';

  interface Props {
    extensions: Array<ExtensionRecord>;
  }

  let { extensions }: Props = $props();

  // Filter for extensions that should be active in the background
  // 1. Must be enabled
  // 2. Must NOT be built-in (those don't run in iframes)
  // 3. Must NOT be the currently active full view (that one is in ExtensionViewContainer)
  //
  // Every Tier 2 extension needs a live iframe so the host can dispatch
  // `asyar:command:execute` to no-view commands (schedules, deeplinks,
  // notification actions, argument-mode commands) and `asyar:search:request`
  // to searchable ones. Gating on searchable || hasSchedule dropped commands
  // that only had `resultType: "no-view"` with arguments — silently swallowing
  // their execution at the host boundary.
  let backgroundExtensions = $derived(
    extensions.filter(ext =>
      ext.enabled &&
      !ext.isBuiltIn &&
      ext.manifest.id !== viewManager.activeView?.split('/')[0]
    )
  );

  // Expose filter inputs + outputs for dev inspection
  $effect(() => {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      (window as unknown as { __asyar_bg__: unknown }).__asyar_bg__ = {
        receivedProp: extensions.map((e) => ({ id: e.manifest?.id, enabled: e.enabled, builtIn: e.isBuiltIn })),
        afterFilter: backgroundExtensions.map((e) => e.manifest.id),
      };
    }
  });

  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
</script>

{#each backgroundExtensions as ext (ext.manifest.id)}
  {@const src = isWindows
    ? `http://asyar-extension.localhost/${ext.manifest.id}/index.html`
    : `asyar-extension://${ext.manifest.id}/index.html`}
  <iframe
    data-extension-id={ext.manifest.id}
    data-background="true"
    src={src}
    style="display: none; width: 0; height: 0; border: 0;"
    sandbox="allow-scripts allow-same-origin"
    title="Background: {ext.manifest.id}"
  ></iframe>
{/each}
