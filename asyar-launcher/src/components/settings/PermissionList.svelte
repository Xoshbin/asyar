<script lang="ts">
  import { describePermission } from '../../services/extension/permissionCatalog';

  let { permissions, permissionArgs = {} } = $props<{
    permissions: string[];
    permissionArgs?: Record<string, unknown>;
  }>();

  function argsFor(permission: string): { chips: string[] | null; json: string | null } {
    const value = permissionArgs?.[permission];
    if (value === undefined || value === null) return { chips: null, json: null };
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return { chips: value as string[], json: null };
    }
    return { chips: null, json: JSON.stringify(value, null, 2) };
  }
</script>

<ul class="flex flex-col gap-3">
  {#each permissions as permission (permission)}
    {@const info = describePermission(permission)}
    {@const args = argsFor(permission)}
    <li class="flex flex-col gap-1">
      <div class="flex items-baseline gap-2 flex-wrap">
        <span class="text-sm font-medium text-[var(--text-primary)]">{info.title}</span>
        <code class="font-mono text-xs text-[var(--text-secondary)]">{permission}</code>
      </div>
      <p class="text-xs text-[var(--text-secondary)]">
        {info.description}
        {#if !info.known}
          <span class="permission-caution">⚠️ Review carefully before allowing.</span>
        {/if}
      </p>
      {#if args.chips}
        <div class="flex flex-wrap gap-1">
          {#each args.chips as chip (chip)}
            <code class="permission-arg-chip font-mono text-xs">{chip}</code>
          {/each}
        </div>
      {:else if args.json}
        <pre class="permission-arg-json font-mono text-xs overflow-x-auto">{args.json}</pre>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .permission-arg-chip,
  .permission-arg-json {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, transparent);
    border-radius: 4px;
    padding: 1px 6px;
    color: var(--text-primary);
    word-break: break-all;
  }

  .permission-arg-json {
    padding: 6px 8px;
    white-space: pre;
  }

  .permission-caution {
    color: var(--accent-danger);
  }
</style>
