<script lang="ts">
  import { onMount } from 'svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import { listen } from '@tauri-apps/api/event';
  import { logService } from '../services/log/logService';
  import PreferencesPromptHost from '../components/settings/PreferencesPromptHost.svelte';
  import { diagnosticsService } from '../services/diagnostics/diagnosticsService.svelte';
  import type { Diagnostic } from 'asyar-sdk/contracts';
  let { children } = $props();

  onMount(async () => {
    try {
      const p = await platform(); // Ensure compatibility by wrapping in await, though often synchronous now
      document.documentElement.dataset.platform = p;
    } catch (e) {
      logService.error(`Failed to get platform: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  onMount(() => {
    const errorHandler = (e: ErrorEvent) => diagnosticsService.report({
      source: 'frontend', kind: 'uncaught_exception', severity: 'error',
      retryable: false,
      developerDetail: e.error?.stack ?? String(e.message),
    });
    const rejectHandler = (e: PromiseRejectionEvent) => diagnosticsService.report({
      source: 'frontend', kind: 'unhandled_rejection', severity: 'error',
      retryable: false, developerDetail: String(e.reason),
    });
    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectHandler);
    const unlistenPromise = listen<Diagnostic>('diagnostics:report', (event) => {
      diagnosticsService.report(event.payload);
    });
    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectHandler);
      void unlistenPromise.then((fn) => fn());
    };
  });
</script>



<svelte:boundary onerror={(err: unknown) => diagnosticsService.report({
  source: 'frontend', kind: 'render_error', severity: 'error',
  retryable: false, developerDetail: String(err),
})}>
  {@render children()}
</svelte:boundary>
<PreferencesPromptHost />
