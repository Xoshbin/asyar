<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsCard from './SettingsCard.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import { runtimeService } from '../../services/runtime/runtimeService.svelte';
  import { describeRuntimeRemovalWarning } from '../../services/runtime/runtimeRemovalGuard';
  import { formatBytes } from '../../services/action/actionService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { logService } from '../../services/log/logService';
  import type { InstalledRuntimeInfo } from '../../lib/ipc/runtimeCommands';

  import { t } from '../../services/i18n';

  let runtimes = $state<InstalledRuntimeInfo[]>([]);
  let isLoading = $state(true);
  let removingName = $state<string | null>(null);

  async function loadRuntimes() {
    try {
      runtimes = await runtimeService.list();
    } catch (e) {
      logService.error(`Failed to load installed runtimes: ${e}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: t('settings.runtimes.error_load_list') },
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
          title: t('settings.runtimes.remove_runtime_title'),
          message: warning,
          confirmText: t('settings.runtimes.remove_anyway'),
          variant: 'danger',
        });
        if (!confirmed) return;
      }
      await runtimeService.remove(name);
      await loadRuntimes();
    } catch (e) {
      logService.error(`Failed to remove runtime "${name}": ${e}`);
      feedbackService.report({
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
  <div class="section-header">{t('settings.runtimes.title')}</div>
  <SettingsCard>
    {#each runtimes as runtime (runtime.name + runtime.version)}
      <SettingsRow
        label={runtime.name}
        description="v{runtime.version} · {formatBytes(runtime.sizeBytes)}"
      >
        <button
          class="remove-btn"
          onclick={() => removeRuntime(runtime.name)}
          disabled={removingName === runtime.name}
        >
          {removingName === runtime.name ? t('settings.runtimes.removing') : t('common.remove')}
        </button>
      </SettingsRow>
    {/each}
  </SettingsCard>
{/if}

<style>
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
