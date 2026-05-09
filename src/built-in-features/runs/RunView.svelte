<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { SplitView, ListItem, EmptyState, Button, StatusDot } from '../../components';
  import { runService } from '../../services/run/runService.svelte';
  import { combineActiveAndRecent, formatRunSubtitle } from './runViewLogic';
  import { statusIconName } from '../../components/run/runningSectionLogic';
  import { invokeSafe } from '../../lib/ipc/invokeSafe';
  import type { Run } from 'asyar-sdk/contracts';

  let combinedRuns = $derived(combineActiveAndRecent(runService.active, runService.recent));
  let selectedRun = $derived(combinedRuns.find((r) => r.id === runService.selectedRunId) ?? null);
  let outputLines = $state<string[]>([]);
  let outputUnlisten: UnlistenFn | null = null;

  onMount(async () => {
    void runService.loadHistory();
    outputUnlisten = await listen<{ id: string; line: string }>('runs:output', (ev) => {
      if (ev.payload.id === runService.selectedRunId) {
        outputLines = [...outputLines, ev.payload.line];
      }
    });
  });

  onDestroy(() => {
    if (outputUnlisten) {
      outputUnlisten();
      outputUnlisten = null;
    }
  });

  $effect(() => {
    const run = selectedRun;
    if (!run) {
      outputLines = [];
      return;
    }
    void invokeSafe<string[]>('runs_get_output', { id: run.id }).then((lines) => {
      outputLines = lines ?? [];
    });
  });

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

  function handleSelectRun(id: string) {
    runService.selectedRunId = id;
  }

  async function handleClearHistory() {
    await runService.clearHistory();
  }

  async function handleCancel() {
    if (selectedRun && selectedRun.status === 'running' && selectedRun.cancellable) {
      await runService.cancelById(selectedRun.id);
    }
  }
</script>

<SplitView>
  {#snippet left()}
    <div class="runs-list custom-scrollbar">
      {#each combinedRuns as run (run.id)}
        <ListItem
          selected={run.id === runService.selectedRunId}
          title={run.label}
          subtitle={formatRunSubtitle(run)}
          onclick={() => handleSelectRun(run.id)}
        >
          {#snippet leading()}
            <StatusDot color={statusDotColor(run.status)} pulse={run.status === 'running'} />
          {/snippet}
        </ListItem>
      {/each}
      {#if combinedRuns.length === 0}
        <EmptyState
          message="No runs yet"
          description="Runs from AI chat or shell scripts will appear here."
        />
      {/if}
      {#if runService.recent.length > 0}
        <div class="runs-list-footer">
          <Button onclick={handleClearHistory}>Clear Recent</Button>
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet right()}
    <div class="run-detail custom-scrollbar">
      {#if selectedRun}
        <div class="run-detail-header">
          <div class="text-title">{selectedRun.label}</div>
          <div class="text-caption run-detail-subtitle">{formatRunSubtitle(selectedRun)}</div>
        </div>
        {#if selectedRun.cancellable && selectedRun.status === 'running'}
          <div class="run-detail-actions">
            <Button onclick={handleCancel}>Cancel</Button>
          </div>
        {/if}
        {#if outputLines.length > 0}
          <div class="run-output custom-scrollbar">
            {#each outputLines as line, i (i)}
              <div class="run-output-line">{line}</div>
            {/each}
          </div>
        {:else}
          <EmptyState
            message="No output yet"
            description={selectedRun.status === 'running'
              ? 'Output will appear as it streams.'
              : 'Output retained only while running.'}
          />
        {/if}
      {:else}
        <EmptyState
          message="Select a run"
          description="Choose a run from the left to see its details."
        />
      {/if}
    </div>
  {/snippet}
</SplitView>

<style>
  .runs-list {
    display: flex;
    flex-direction: column;
    padding: var(--space-2);
    height: 100%;
    overflow-y: auto;
  }

  .runs-list-footer {
    padding: var(--space-3) var(--space-2);
  }

  .run-detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    height: 100%;
    overflow-y: auto;
  }

  .run-detail-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .run-detail-subtitle {
    color: var(--text-secondary);
  }

  .run-detail-actions {
    display: flex;
    gap: var(--space-2);
  }

  .run-output {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .run-output-line {
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
    line-height: 1.5;
  }
</style>
