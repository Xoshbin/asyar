<script lang="ts">
  import { onMount } from 'svelte';
  import { getScheduledTasks, type ScheduledTaskInfo } from '../../lib/ipc/commands';
  import { envService } from '../../services/envService';
  import SettingsForm from './SettingsForm.svelte';
  import SettingsFormRow from './SettingsFormRow.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import { logService } from '../../services/log/logService';

  let tasks = $state<ScheduledTaskInfo[]>([]);
  let isLoading = $state(true);

  function formatInterval(seconds: number): string {
    if (seconds < 120) return `every ${seconds} seconds`;
    if (seconds < 7200) return `every ${Math.round(seconds / 60)} minutes`;
    if (seconds < 172800) return `every ${Math.round(seconds / 3600)} hours`;
    return `every ${Math.round(seconds / 86400)} days`;
  }

  async function loadTasks() {
    if (!envService.isTauri) {
      isLoading = false;
      return;
    }
    try {
      tasks = await getScheduledTasks();
    } catch (e) {
      logService.error(`Failed to load scheduled tasks: ${e}`);
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'warning',
        retryable: false,
        context: { message: 'Could not load scheduled tasks list' },
      });
      tasks = [];
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadTasks();
  });
</script>

{#if !isLoading && tasks.length > 0}
  <div class="section-header">Scheduled Tasks</div>
  <SettingsForm>
    {#each tasks as task}
      <SettingsFormRow
        label={task.extensionName}
        description="{task.commandName} · {formatInterval(task.intervalSeconds)}"
      >
        {#if task.active}
          <span class="badge badge-active">
            <span class="badge-dot"></span>
            Active
          </span>
        {:else}
          <span class="badge badge-paused">Paused</span>
        {/if}
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

  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: 10px;
    font-weight: 500;
    font-family: var(--font-ui);
    padding: 2px var(--space-2);
    border-radius: var(--radius-full);
  }

  .badge-active {
    background: color-mix(in srgb, var(--accent-success) 12%, transparent);
    color: var(--accent-success);
  }

  .badge-paused {
    background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
    color: var(--text-tertiary);
  }

  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
</style>
