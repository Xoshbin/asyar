<script lang="ts">
  import SettingsSection from './SettingsSection.svelte';
  import { onMount } from 'svelte';
  import {
    shellListTrusted,
    shellRevokeTrust,
    discoverExtensions,
    type TrustedBinary,
  } from '../../lib/ipc/commands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
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

<SettingsSection title="Terminal Trust Store">
  <div class="px-6 pb-6 space-y-6">
    {#if isLoading}
      <p class="text-xs text-[var(--text-tertiary)] leading-relaxed">Loading trusted programs…</p>
    {:else if groupedTrusts.length > 0}
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
                <div
                  class="w-5 h-5 rounded-sm bg-[var(--bg-tertiary)] flex items-center justify-center text-[length:var(--font-size-2xs)] font-bold text-[var(--text-secondary)]"
                >
                  {group.extensionName.charAt(0).toUpperCase()}
                </div>
              {/if}
              <span class="text-sm font-semibold text-[var(--text-primary)]"
                >{group.extensionName}</span
              >
              <span class="text-[length:var(--font-size-2xs)] text-[var(--text-tertiary)] font-mono"
                >{group.extensionId}</span
              >
            </div>

            <div class="grid gap-2 pl-8">
              {#each group.binaries as binary}
                <div
                  class="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--separator)] hover:border-[var(--border-color)] transition-colors group"
                >
                  <div class="flex flex-col gap-0.5 min-w-0">
                    <span
                      class="text-xs font-mono text-[var(--accent-primary)] truncate"
                      title={binary.binaryPath}
                    >
                      {binary.binaryPath}
                    </span>
                    <span class="text-[length:var(--font-size-2xs)] text-[var(--text-tertiary)]">
                      Trusted {formatRelativeTime(binary.trustedAt)}
                    </span>
                  </div>

                  <button
                    class="px-2.5 py-1 rounded-md text-[length:var(--font-size-2xs)] font-medium bg-[color-mix(in_srgb,var(--accent-danger)_10%,transparent)] text-[var(--accent-danger)] hover:bg-[color-mix(in_srgb,var(--accent-danger)_20%,transparent)] border border-[color-mix(in_srgb,var(--accent-danger)_20%,transparent)] transition-all opacity-0 group-hover:opacity-100"
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
    {:else}
      <p class="text-xs text-[var(--text-tertiary)] leading-relaxed">
        No programs are trusted yet. When an extension runs a binary — or you approve its declared
        binaries at install — they’ll appear here to review or revoke.
      </p>
    {/if}
  </div>
</SettingsSection>
