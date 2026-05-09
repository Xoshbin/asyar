<script lang="ts">
  import { Icon, ListItem, StatusDot } from '../index';
  import { runService } from '../../services/run/runService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { groupRunsByKind, formatElapsed, statusIconName } from './runningSectionLogic';
  import type { Run } from 'asyar-sdk/contracts';

  let now = $state(Date.now());

  $effect(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });

  const groups = $derived(groupRunsByKind(runService.active));

  function handleRunClick(run: Run) {
    runService.selectedRunId = run.id;
    viewManager.navigateToView('runs/RunView');
  }

  function statusDotColor(status: Run['status']): 'success' | 'warning' | 'danger' | 'info' {
    switch (status) {
      case 'running':
        return 'info';
      case 'succeeded':
        return 'success';
      case 'failed':
        return 'danger';
      case 'cancelled':
        return 'warning';
      default:
        return 'info';
    }
  }
</script>

{#if runService.active.length > 0}
  <div class="running-section">
    {#each groups as group (group.title)}
      <div class="section-header">{group.title}</div>
      {#each group.runs as run (run.id)}
        <ListItem
          title={run.label}
          subtitle={formatElapsed(now - run.startedAt)}
          onclick={() => handleRunClick(run)}
        >
          {#snippet leading()}
            <StatusDot color={statusDotColor(run.status)} pulse={run.status === 'running'} />
          {/snippet}
          {#snippet trailing()}
            <Icon name={statusIconName(run.status)} size={16} class="shrink-0" />
          {/snippet}
        </ListItem>
      {/each}
    {/each}
  </div>
{/if}

<style>
  .running-section {
    border-bottom: 1px solid var(--separator);
    padding-bottom: var(--space-2);
  }
</style>
