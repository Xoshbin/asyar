<script lang="ts">
  import SettingsSection from './SettingsSection.svelte';
  import { onMount } from 'svelte';
  import { getScheduledTasks, type ScheduledTaskInfo } from '../../lib/ipc/commands';
  import { envService } from '../../services/envService';

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
      console.error('Failed to load scheduled tasks:', e);
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
  <SettingsSection title="Scheduled Tasks">
    <div class="px-6 pb-6 space-y-3">
      <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
        These extensions run background tasks on a recurring schedule.
      </p>

      <div class="grid gap-2">
        {#each tasks as task}
          <div class="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
            <div class="flex flex-col gap-0.5">
              <span class="text-sm font-medium text-[var(--text-primary)]">{task.extensionName}</span>
              <span class="text-xs text-[var(--text-secondary)]">
                {task.commandName} &middot; {formatInterval(task.intervalSeconds)}
              </span>
            </div>
            <div class="flex items-center">
              {#if task.active}
                <span class="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style="background: color-mix(in srgb, var(--accent-success) 12%, transparent); color: var(--accent-success);">
                  <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
                  Active
                </span>
              {:else}
                <span class="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style="background: color-mix(in srgb, var(--text-tertiary) 12%, transparent); color: var(--text-tertiary);">
                  Paused
                </span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </SettingsSection>
{/if}
