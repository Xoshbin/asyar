<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { platform } from '@tauri-apps/plugin-os';
  import { onMount, type Snippet } from 'svelte';
  import RuntimeBatchConsentDialog from '../../built-in-features/create-extension/ai-builder/RuntimeBatchConsentDialog.svelte';
  import { extBuilderRuntimeConsentStore } from '../../built-in-features/create-extension/ai-builder/runtimeConsentStore.svelte';
  import PermissionPromptDialog from '../../built-in-features/mcp/PermissionPromptDialog.svelte';
  import RuntimeConsentDialog from '../../built-in-features/mcp/RuntimeConsentDialog.svelte';
  import { mcpService } from '../../built-in-features/mcp/mcpService.svelte';
  import { extractErrorMessage } from '../../lib/errors';
  import { installIdleCallbackPolyfill } from '../../lib/idle';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import type { HostFeedbackReport } from '../../services/feedback/feedbackService.svelte';
  import { logService } from '../../services/log/logService';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { applyThemePreference } from '../../services/theme/themeMode';
  import PreferencesPromptHost from '../settings/PreferencesPromptHost.svelte';

  let { children }: { children: Snippet } = $props();

  // Idle scheduling must exist before any service defers work through
  // runWhenIdle. WebKit gates requestIdleCallback behind a feature flag the
  // Rust side flips best-effort; this makes the API's presence a guarantee.
  installIdleCallbackPolyfill();

  onMount(async () => {
    try {
      const p = await platform();
      document.documentElement.dataset.platform = p;
    } catch (e) {
      logService.error(`Failed to get platform: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  $effect(() => {
    if (!settingsService.initialized) return;
    applyThemePreference(settingsService.currentSettings.appearance.theme);
  });

  onMount(() => {
    void feedbackService.initialize();
    const errorHandler = (e: ErrorEvent) => {
      const detail = e.error?.stack ?? extractErrorMessage(e.message);
      feedbackService.report({
        source: 'frontend',
        kind: 'uncaught_exception',
        severity: 'error',
        retryable: false,
        developerDetail: detail,
        context: { message: extractErrorMessage(e.message ?? e.error) },
      });
    };
    const rejectHandler = (e: PromiseRejectionEvent) => {
      const detail = extractErrorMessage(e.reason);
      feedbackService.report({
        source: 'frontend',
        kind: 'unhandled_rejection',
        severity: 'error',
        retryable: false,
        developerDetail: detail,
        context: { message: detail },
      });
    };
    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectHandler);
    const unlistenPromise = listen<HostFeedbackReport>('feedback:report', (event) => {
      feedbackService.report(event.payload);
    });
    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectHandler);
      void unlistenPromise.then((fn) => fn());
    };
  });
</script>

<svelte:boundary
  onerror={(err: unknown) =>
    feedbackService.report({
      source: 'frontend',
      kind: 'render_error',
      severity: 'error',
      retryable: false,
      developerDetail: String(err),
    })}
>
  {@render children()}
</svelte:boundary>
<PreferencesPromptHost />

{#if mcpService.permissionPrompt}
  <PermissionPromptDialog
    serverId={mcpService.permissionPrompt.serverId}
    toolId={mcpService.permissionPrompt.toolId}
    agentId={mcpService.permissionPrompt.agentId}
    onDecide={(d) => mcpService.handlePermissionDecision(d)}
  />
{/if}

{#if mcpService.runtimeConsentPrompt}
  <RuntimeConsentDialog
    name={mcpService.runtimeConsentPrompt.name}
    sizeBytes={mcpService.runtimeConsentPrompt.sizeBytes}
    onDecide={(approved) => mcpService.handleRuntimeConsentDecision(approved)}
  />
{/if}

{#if extBuilderRuntimeConsentStore.prompt}
  <RuntimeBatchConsentDialog
    runtimes={extBuilderRuntimeConsentStore.prompt.runtimes}
    onDecide={(approved) => extBuilderRuntimeConsentStore.decide(approved)}
  />
{/if}
