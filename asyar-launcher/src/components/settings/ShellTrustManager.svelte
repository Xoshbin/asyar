<script lang="ts">
  import SettingsSection from './SettingsSection.svelte';
  import { onMount } from 'svelte';
  import { extensionManager } from '../../services/extension/extensionManager.svelte';
  import { shellListTrusted, shellRevokeTrust, type TrustedBinary } from '../../lib/ipc/commands';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import { logService } from '../../services/log/logService';

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
    const recordsWithShell = extensionManager.extensionRecords.filter(r => 
      r.manifest.permissions?.includes('shell:spawn')
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
        
        if (binaries.length > 0) {
          results.push({
            extensionId: record.manifest.id,
            extensionName: record.manifest.name,
            extensionIcon: record.manifest.icon ? `asyar-icon://${record.manifest.id}/${record.manifest.icon}` : undefined,
            binaries: binaries.sort((a, b) => b.trustedAt - a.trustedAt)
          });
        }
      } catch (e) {
        logService.error(`Failed to load trust for ${record.manifest.id}: ${e}`);
        diagnosticsService.report({
          source: 'frontend', kind: 'manual', severity: 'warning',
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
      groupedTrusts = groupedTrusts.map(group => {
        if (group.extensionId === extensionId) {
          return {
            ...group,
            binaries: group.binaries.filter(b => b.binaryPath !== binaryPath)
          };
        }
        return group;
      }).filter(group => group.binaries.length > 0);
    } catch (e) {
      logService.error(`Failed to revoke shell trust for ${extensionId} (${binaryPath}): ${e}`);
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'error',
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

{#if !isLoading && groupedTrusts.length > 0}
  <SettingsSection title="Terminal Trust Store">
    <div class="px-6 pb-6 space-y-6">
      <p class="text-xs text-[var(--text-secondary)] leading-relaxed">
        The following programs have been explicitly trusted for execution by specific extensions. 
        Revoking trust will cause the extension to prompt for permission again on next use.
      </p>

      <div class="space-y-6">
        {#each groupedTrusts as group}
          <div class="space-y-3">
            <div class="flex items-center gap-3">
              {#if group.extensionIcon}
                <img src={group.extensionIcon} alt="" class="w-5 h-5 rounded-sm" />
              {:else}
                <div class="w-5 h-5 rounded-sm bg-[var(--bg-tertiary)] flex items-center justify-center text-[10px] font-bold text-[var(--text-secondary)]">
                  {group.extensionName.charAt(0).toUpperCase()}
                </div>
              {/if}
              <span class="text-sm font-semibold text-[var(--text-primary)]">{group.extensionName}</span>
              <span class="text-[10px] text-[var(--text-tertiary)] font-mono">{group.extensionId}</span>
            </div>

            <div class="grid gap-2 pl-8">
              {#each group.binaries as binary}
                <div class="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-color)] transition-colors group">
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <span class="text-xs font-mono text-[var(--accent-primary)] truncate" title={binary.binaryPath}>
                      {binary.binaryPath}
                    </span>
                    <span class="text-[10px] text-[var(--text-tertiary)]">
                      Trusted {formatRelativeTime(binary.trustedAt)}
                    </span>
                  </div>
                  
                  <button 
                    class="px-2.5 py-1 rounded-md text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all opacity-0 group-hover:opacity-100"
                    onclick={() => revokeTrust(group.extensionId, binary.binaryPath)}
                  >
                    Revoke
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </SettingsSection>
{/if}
