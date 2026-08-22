<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, EmptyState, SettingsCard } from '../index';
  import {
    shellListTrusted,
    shellRevokeTrust,
    discoverExtensions,
    type TrustedBinary,
  } from '../../lib/ipc/commands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';

  interface GroupedTrust {
    extensionId: string;
    extensionName: string;
    extensionIcon?: string;
    binaries: TrustedBinary[];
  }

  let groupedTrusts = $state<GroupedTrust[]>([]);
  let isLoading = $state(true);

  async function loadTrustData() {
    isLoading = true;
    // Source the list via IPC (`discover_extensions`), not
    // `extensionManager.extensionRecords` — that in-memory array is only
    // populated in the main launcher window, so it's empty in this settings
    // webview and the panel would always render as empty.
    const allRecords = (await discoverExtensions()) ?? [];
    const recordsWithShell = allRecords.filter((r) =>
      r.manifest.permissions?.includes('shell:spawn'),
    );

    if (recordsWithShell.length === 0) {
      groupedTrusts = [];
      isLoading = false;
      return;
    }

    const results: GroupedTrust[] = [];

    for (const record of recordsWithShell) {
      try {
        const binaries = await shellListTrusted(record.manifest.id);
        if (binaries === null) {
          throw new Error('shell_list_trusted failed');
        }

        if (binaries.length > 0) {
          results.push({
            extensionId: record.manifest.id,
            extensionName: record.manifest.name,
            extensionIcon: record.manifest.icon
              ? `asyar-icon://${record.manifest.id}/${record.manifest.icon}`
              : undefined,
            binaries: binaries.sort((a, b) => b.trustedAt - a.trustedAt),
          });
        }
      } catch (e) {
        logService.error(`Failed to load trust for ${record.manifest.id}: ${e}`);
        feedbackService.report({
          source: 'frontend',
          kind: 'manual',
          severity: 'warning',
          retryable: false,
          context: { message: `Could not load shell trust for ${record.manifest.name}` },
        });
      }
    }

    groupedTrusts = results;
    isLoading = false;
  }

  async function revokeTrust(extensionId: string, binaryPath: string) {
    try {
      await shellRevokeTrust(extensionId, binaryPath);

      // Optimistic update
      groupedTrusts = groupedTrusts
        .map((group) => {
          if (group.extensionId === extensionId) {
            return {
              ...group,
              binaries: group.binaries.filter((b) => b.binaryPath !== binaryPath),
            };
          }
          return group;
        })
        .filter((group) => group.binaries.length > 0);
    } catch (e) {
      logService.error(`Failed to revoke shell trust for ${extensionId} (${binaryPath}): ${e}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not revoke shell trust for ${binaryPath}` },
      });
    }
  }

  function formatRelativeTime(timestamp: number) {
    const diff = Date.now() - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  }

  onMount(() => {
    loadTrustData();
  });
</script>

<div class="section-header">Shell trust</div>
<SettingsCard>
  <div class="shell-trust-content">
    {#if isLoading}
      <p class="trust-note text-caption">Loading trusted programs...</p>
    {:else if groupedTrusts.length > 0}
      <p class="trust-note text-caption">
        The following programs have been explicitly trusted for execution by specific extensions.
        Revoking trust will cause the extension to prompt for permission again on next use.
      </p>

      <div class="trust-groups">
        {#each groupedTrusts as group}
          <div class="trust-group">
            <div class="trust-group-header">
              {#if group.extensionIcon}
                <img src={group.extensionIcon} alt="" class="trust-icon" />
              {:else}
                <div class="trust-icon trust-icon-fallback">
                  {group.extensionName.charAt(0).toUpperCase()}
                </div>
              {/if}
              <span class="trust-name">{group.extensionName}</span>
              <span class="trust-id text-mono">{group.extensionId}</span>
            </div>

            <div class="trust-binaries">
              {#each group.binaries as binary}
                <div class="trust-binary-row">
                  <div class="trust-binary-text">
                    <span class="trust-binary-path text-mono" title={binary.binaryPath}>
                      {binary.binaryPath}
                    </span>
                    <span class="trust-binary-meta text-caption">
                      Trusted {formatRelativeTime(binary.trustedAt)}
                    </span>
                  </div>

                  <Button
                    class="btn-secondary"
                    onclick={() => revokeTrust(group.extensionId, binary.binaryPath)}
                  >
                    Revoke
                  </Button>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <EmptyState
        compact
        message={t('settings.privacy.no_trusted_programs')}
        description={t('settings.privacy.no_trusted_programs_description')}
      />
    {/if}
  </div>
</SettingsCard>

<style>
  .shell-trust-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-6);
  }

  .trust-note {
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .trust-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .trust-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .trust-group-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .trust-icon {
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .trust-icon-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
    font-weight: 600;
  }

  .trust-name {
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-weight: 600;
  }

  .trust-id {
    color: var(--text-tertiary);
    font-size: var(--font-size-2xs);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trust-binaries {
    display: grid;
    gap: var(--space-2);
    padding-left: calc(20px + var(--space-3));
  }

  .trust-binary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    transition: border-color var(--transition-fast);
  }

  .trust-binary-row:hover {
    border-color: var(--border-color);
  }

  .trust-binary-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .trust-binary-path {
    color: var(--accent-primary);
    font-size: var(--font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trust-binary-meta {
    color: var(--text-tertiary);
  }
</style>
