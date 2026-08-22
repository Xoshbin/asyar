<script lang="ts">
  import { onMount } from 'svelte';
  import { getScheduledTasks, type ScheduledTaskInfo } from '../../lib/ipc/commands';
  import SettingsCard from './SettingsCard.svelte';
  import SettingsRow from './SettingsRow.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';

  let tasks = $state<ScheduledTaskInfo[]>([]);
  let isLoading = $state(true);

  function formatInterval(seconds: number): string {
    if (seconds < 120) return `every ${seconds} seconds`;
    if (seconds < 7200) return `every ${Math.round(seconds / 60)} minutes`;
    if (seconds < 172800) return `every ${Math.round(seconds / 3600)} hours`;
    return `every ${Math.round(seconds / 86400)} days`;
  }

  async function loadTasks() {
    try {
      tasks = (await getScheduledTasks()) ?? [];
    } catch (e) {
      logService.error(`Failed to load scheduled tasks: ${e}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: t('settings.tasks.error_load_list') },
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
  <div class="section-header">{t('settings.tasks.title')}</div>
  <SettingsCard>
    <div id="advanced-scheduled-tasks">
      {#each tasks as task}
        <SettingsRow
          label={task.extensionName}
          description="{task.commandName} · {formatInterval(task.intervalSeconds)}"
        >
          {#if task.active}
            <span class="badge badge-active">
              <span class="badge-dot"></span>
              {t('common.active')}
            </span>
          {:else}
            <span class="badge badge-paused">{t('common.paused')}</span>
          {/if}
        </SettingsRow>
      {/each}
    </div>
  </SettingsCard>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-2xs);
    font-weight: 500;
    font-family: var(--font-ui);
    padding: var(--space-0-5) var(--space-2);
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
