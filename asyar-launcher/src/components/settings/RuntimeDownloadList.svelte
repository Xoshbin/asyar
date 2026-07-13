<script lang="ts">
  import type { RuntimeDownload } from '../../lib/ipc/runtimeCommands';

  let { runtimes }: { runtimes: RuntimeDownload[] } = $props();

  function formatBytes(bytes: number): string {
    if (bytes <= 0) return 'an unknown size';
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
</script>

{#if runtimes.length > 0}
  <div class="runtime-downloads">
    <span class="text-label">Downloads</span>
    <ul class="flex flex-col gap-1">
      {#each runtimes as runtime (runtime.name)}
        <li class="flex items-baseline gap-2">
          <code class="font-mono text-xs text-[var(--text-primary)]">{runtime.name}</code>
          <span class="text-xs text-[var(--text-secondary)]"
            >({formatBytes(runtime.sizeBytes)})</span
          >
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .runtime-downloads {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--separator);
  }
</style>
