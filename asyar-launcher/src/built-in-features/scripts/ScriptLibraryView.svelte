<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { scriptsManager } from './scriptsManager.svelte';
  import {
    Badge,
    Card,
    EmptyState,
    Icon,
    IconBox,
    LauncherListRow,
    SplitView,
    WarningBanner,
  } from '../../components';
  import { isAnyModalOpen } from '../../components/base/Modal.logic';
  import type { ScriptScanIssueReason } from './types';

  const scripts = $derived(scriptsManager.scripts);
  const issues = $derived(scriptsManager.issues);
  const selectedScript = $derived(scriptsManager.selectedScript);
  const selectedIssue = $derived(scriptsManager.selectedIssue);

  function issueLabel(reason: ScriptScanIssueReason): string {
    switch (reason) {
      case 'directoryUnreadable':
        return 'Directory unavailable';
      case 'metadataUnreadable':
        return 'Metadata unavailable';
      case 'pathUnavailable':
        return 'Path unavailable';
      case 'notExecutable':
        return 'Not executable';
      case 'contentUnreadable':
        return 'Unreadable';
      case 'invalidHeader':
        return 'Invalid header';
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (document.querySelector('.action-popup') || isAnyModalOpen(document)) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      scriptsManager.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  onMount(() => window.addEventListener('keydown', handleWindowKeydown, true));
  onDestroy(() => window.removeEventListener('keydown', handleWindowKeydown, true));
</script>

<SplitView leftWidth="38%">
  {#snippet left()}
    <div class="h-full p-2" role="listbox" aria-label="Scripts and issues">
      {#if scripts.length === 0 && issues.length === 0}
        <EmptyState
          message="No scripts found"
          description="Executable files from watched directories appear here."
        >
          {#snippet icon()}
            <Icon name="terminal" size={28} />
          {/snippet}
        </EmptyState>
      {:else}
        {#if scripts.length > 0}
          {#each scripts as script, index (script.dynamicId)}
            {#if index === 0 || scripts[index - 1]?.directoryPath !== script.directoryPath}
              <div class="section-header px-3 py-2 truncate" title={script.directoryPath}>
                {script.directoryPath}
              </div>
            {/if}
            <LauncherListRow
              icon={script.header.icon ?? 'icon:terminal'}
              title={script.displayName}
              subtitle={script.fileName}
              typeLabel={script.header.mode}
              selected={scriptsManager.selectedEntryId === `script:${script.dynamicId}`}
              onclick={() => scriptsManager.selectEntry(`script:${script.dynamicId}`)}
            />
          {/each}
        {/if}

        {#if issues.length > 0}
          <div class="section-header px-3 py-2">Issues</div>
          {#each issues as issue, index (issue.absolutePath)}
            {#if index === 0 || issues[index - 1]?.directoryPath !== issue.directoryPath}
              <div class="section-header px-3 py-2 truncate" title={issue.directoryPath}>
                {issue.directoryPath}
              </div>
            {/if}
            <LauncherListRow
              icon="icon:info"
              title={issue.fileName}
              subtitle={issue.message}
              typeLabel="Issue"
              selected={scriptsManager.selectedEntryId === `issue:${issue.absolutePath}`}
              onclick={() => scriptsManager.selectEntry(`issue:${issue.absolutePath}`)}
            />
          {/each}
        {/if}
      {/if}
    </div>
  {/snippet}

  {#snippet right()}
    {#if selectedScript}
      <div class="h-full overflow-y-auto custom-scrollbar p-6">
        <div class="flex items-center gap-4 mb-6">
          <IconBox size="lg">
            {#snippet content()}
              <Icon name="terminal" size={24} />
            {/snippet}
          </IconBox>
          <div class="min-w-0 flex-1">
            <div class="text-page-title truncate">{selectedScript.displayName}</div>
            <div class="text-caption text-mono truncate">{selectedScript.absolutePath}</div>
          </div>
          <Badge text={selectedScript.header.mode} variant="info" />
        </div>

        <Card title="Configuration">
          <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 text-body">
            <dt class="text-label text-[var(--text-secondary)]">File</dt>
            <dd class="text-mono break-all text-[var(--text-primary)]">
              {selectedScript.fileName}
            </dd>
            <dt class="text-label text-[var(--text-secondary)]">Directory</dt>
            <dd class="text-mono break-all text-[var(--text-primary)]">
              {selectedScript.directoryPath}
            </dd>
            <dt class="text-label text-[var(--text-secondary)]">Arguments</dt>
            <dd class="text-[var(--text-primary)]">
              {#if selectedScript.header.arguments.length === 0}
                None
              {:else}
                <div class="flex flex-wrap gap-2">
                  {#each selectedScript.header.arguments as argument (argument.name)}
                    <Badge text={argument.name} mono bordered />
                  {/each}
                </div>
              {/if}
            </dd>
            {#if selectedScript.header.mode === 'inline'}
              <dt class="text-label text-[var(--text-secondary)]">Refresh</dt>
              <dd class="text-[var(--text-primary)]">
                {selectedScript.header.refreshTimeSeconds
                  ? `${selectedScript.header.refreshTimeSeconds}s`
                  : 'Manual'}
              </dd>
            {/if}
          </dl>
        </Card>
      </div>
    {:else if selectedIssue}
      <div class="h-full overflow-y-auto custom-scrollbar p-6">
        <div class="flex items-center gap-4 mb-6">
          <IconBox size="lg">
            {#snippet content()}
              <Icon name="info" size={24} />
            {/snippet}
          </IconBox>
          <div class="min-w-0 flex-1">
            <div class="text-page-title truncate">{selectedIssue.fileName}</div>
            <div class="text-caption text-mono truncate">{selectedIssue.directoryPath}</div>
          </div>
          <Badge text={issueLabel(selectedIssue.reason)} variant="warning" />
        </div>

        <WarningBanner>
          <div class="text-title">{issueLabel(selectedIssue.reason)}</div>
          <div class="text-caption mt-1">{selectedIssue.message}</div>
        </WarningBanner>

        <div class="mt-6">
          <Card title="File">
            <div class="text-mono break-all text-body text-[var(--text-primary)]">
              {selectedIssue.absolutePath}
            </div>
          </Card>
        </div>
      </div>
    {:else}
      <EmptyState message="Select a script or issue" />
    {/if}
  {/snippet}
</SplitView>
