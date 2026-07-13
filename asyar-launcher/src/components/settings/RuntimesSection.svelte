<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsForm from './SettingsForm.svelte';
  import SettingsFormRow from './SettingsFormRow.svelte';
  import { runtimeService } from '../../services/runtime/runtimeService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { describeRuntimeRemovalWarning } from '../../services/runtime/runtimeRemovalGuard';
  import { formatBytes } from '../../services/action/actionService.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import { logService } from '../../services/log/logService';
  import type { InstalledRuntimeInfo } from '../../lib/ipc/runtimeCommands';

  let runtimes = $state<InstalledRuntimeInfo[]>([]);
  let isLoading = $state(true);
  let removingName = $state<string | null>(null);

  async function loadRuntimes() {
    try {
      runtimes = await runtimeService.list();
    } catch (e) {
      logService.error(`Failed to load installed runtimes: ${e}`);
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: 'Could not load installed runtimes list' },
      });
      runtimes = [];
    } finally {
      isLoading = false;
    }
  }

  async function removeRuntime(name: string) {
    removingName = name;
    try {
      const consumers = await runtimeService.consumersOf(name);
      const warning = describeRuntimeRemovalWarning(consumers);
      if (warning) {
        const confirmed = await feedbackService.confirmAlert({
          title: 'Remove Runtime',
          message: warning,
          confirmText: 'Remove Anyway',
          variant: 'danger',
        });
        if (!confirmed) return;
      }
      await runtimeService.remove(name);
      await loadRuntimes();
    } catch (e) {
      logService.error(`Failed to remove runtime "${name}": ${e}`);
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not remove runtime "${name}"` },
      });
    } finally {
      removingName = null;
    }
  }

  onMount(() => {
    loadRuntimes();
  });
</script>

{#if !isLoading && runtimes.length > 0}
  <div class="section-header">Installed Runtimes</div>
  <SettingsForm>
    {#each runtimes as runtime (runtime.name + runtime.version)}
      <SettingsFormRow
        label={runtime.name}
        description="v{runtime.version} · {formatBytes(runtime.sizeBytes)}"
      >
        <button
          class="remove-btn"
          onclick={() => removeRuntime(runtime.name)}
          disabled={removingName === runtime.name}
        >
          {removingName === runtime.name ? 'Removing…' : 'Remove'}
        </button>
      </SettingsFormRow>
    {/each}
  </SettingsForm>
{/if}

<style>
  .section-header {
    padding: var(--space-4) var(--space-6) var(--space-2);
    font-size: var(--font-size-xs);
    font-weight: 600;
    font-family: var(--font-ui);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-top: 1px solid var(--separator);
  }

  .remove-btn {
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: var(--transition-fast);
  }

  .remove-btn:hover {
    opacity: 0.8;
  }

  .remove-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
