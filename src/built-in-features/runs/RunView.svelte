<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { SplitView, ListItem, EmptyState, Button, StatusDot } from '../../components';
  import { runService } from '../../services/run/runService.svelte';
  import { formatRunSubtitle } from './runViewLogic';
  import { statusIconName } from '../../components/run/runningSectionLogic';
  import { invokeSafe } from '../../lib/ipc/invokeSafe';
  import { scrollSelectedIntoView } from '../../lib/listScroll';
  import type { Run } from 'asyar-sdk/contracts';

  let combinedRuns = $derived(runService.combined);
  let selectedRun = $derived(combinedRuns.find((r) => r.id === runService.selectedRunId) ?? null);
  let selectedIndex = $derived(
    runService.selectedRunId ? combinedRuns.findIndex((r) => r.id === runService.selectedRunId) : -1,
  );
  let outputLines = $state<string[]>([]);
  let outputUnlisten: UnlistenFn | null = null;
  let listEl = $state<HTMLDivElement | undefined>();

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

  $effect(() => {
    const idx = selectedIndex;
    if (idx < 0 || !listEl) return;
    requestAnimationFrame(() => {
      if (listEl) scrollSelectedIntoView(listEl, idx);
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
    <div class="runs-list custom-scrollbar" bind:this={listEl}>
      {#each combinedRuns as run, index (run.id)}
        <ListItem
          data-index={index}
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
        {#if selectedRun.kind === 'agent' || selectedRun.kind === 'ai-chat'}
          <div class="run-status-panel">
            <div class="run-status-header">
              <span>💬</span>
              <span class="text-title">AI Chat Thread</span>
            </div>
            <div class="run-status-content">
              <div class="text-caption">This run was managed inside an AI conversation thread. Output response streams and state are persisted directly within the agent chat interface. Use the command menu (Cmd+K) to View Conversation.</div>
            </div>
          </div>
        {:else if outputLines.length > 0}
          <div class="run-output custom-scrollbar">
            {#each outputLines as line, i (i)}
              <div class="run-output-line">{line}</div>
            {/each}
          </div>
        {:else if selectedRun.status === 'failed'}
          <div class="run-status-panel run-status-failed">
            <div class="run-status-header">
              <span>❌</span>
              <span class="text-title" style="color: var(--accent-danger);">Execution Failed</span>
            </div>
            <div class="run-status-content">
              <div class="text-caption">The execution failed or returned an error:</div>
              <div class="run-status-error-box">
                {selectedRun.errorMessage || 'Script exited with non-zero status.'}
              </div>
            </div>
          </div>
        {:else if selectedRun.status === 'succeeded'}
          <div class="run-status-panel run-status-success">
            <div class="run-status-header">
              <span>✅</span>
              <span class="text-title" style="color: var(--accent-success);">Finished Successfully</span>
            </div>
            <div class="run-status-content">
              {#if selectedRun.endedAt && selectedRun.startedAt}
                <div class="text-caption">
                  Process successfully completed in {((selectedRun.endedAt - selectedRun.startedAt) / 1000).toFixed(2)} seconds.
                </div>
              {:else}
                <div class="text-caption">Execution successful. The script terminated without printing any output to standard out.</div>
              {/if}
            </div>
          </div>
        {:else}
          <EmptyState
            message="No output yet"
            description={selectedRun.status === 'running'
              ? 'Output will appear as it streams.'
              : 'Output has been dismissed.'}
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

  .run-status-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }

  .run-status-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: 600;
  }

  .run-status-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .run-status-error-box {
    background: color-mix(in srgb, var(--accent-danger) 8%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--accent-danger) 20%, transparent);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    color: var(--accent-danger);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }
</style>
