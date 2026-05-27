<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Button from '../../components/base/Button.svelte';
  import { fadeIn, popupScale } from '$lib/transitions';
  import { mcpService } from './mcpService.svelte';
  import { agentService } from '../agents/agentService.svelte';

  let { serverId, toolId, agentId, onDecide } = $props<{
    serverId: string;
    toolId: string;
    agentId: string;
    onDecide: (decision: 'allow_once' | 'allow_always' | 'never' | 'cancel') => void;
  }>();

  const server = $derived(mcpService.servers.find((s) => s.id === serverId));
  const serverLabel = $derived(server?.displayName ?? serverId);

  // Look up the agent name; fall back to a short UUID prefix if missing
  // rather than the full UUID, which is user-hostile.
  const agentLabel = $derived.by(() => {
    const agent = agentService.getById(agentId);
    if (agent?.name) return agent.name;
    return agentId ? `agent ${agentId.slice(0, 8)}` : 'an agent';
  });

  // Pull a tool description from the registered tool descriptor, falling
  // back to a generic notice. Avoids the previous hardcoded "may modify
  // data or execute commands" being shown even for harmless tools.
  const toolDescription = $derived.by(() => {
    const tool = server?.tools?.find((t) => t.id === toolId);
    return tool?.description ?? '';
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      onDecide('cancel');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      onDecide('allow_once');
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

<div
  class="fixed inset-0 dialog-backdrop flex items-center justify-center z-[200]"
  onclick={(e) => e.target === e.currentTarget && onDecide('cancel')}
  role="button"
  tabindex="0"
  onkeydown={(event) =>
    event.key === 'Enter' || event.key === ' ' ? onDecide('cancel') : null}
  transition:fadeIn={{ duration: 150 }}
>
  <div
    class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-md overflow-hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="mcp-permission-title"
    transition:popupScale={{ duration: 120 }}
  >
    <div class="p-6">
      <h2
        id="mcp-permission-title"
        class="text-xl font-semibold mb-4 text-[var(--text-primary)]"
      >
        Allow MCP tool call?
      </h2>
      <p class="text-[var(--text-secondary)] mb-3">
        <strong>{agentLabel}</strong> wants to call
        <code class="font-mono text-sm">{toolId}</code>
        on <strong>{serverLabel}</strong>.
      </p>
      {#if toolDescription}
        <p class="text-[var(--text-secondary)] text-sm mb-6 italic">
          {toolDescription}
        </p>
      {:else}
        <p class="text-[var(--text-secondary)] text-sm mb-6 italic">
          No description provided by the server.
        </p>
      {/if}

      <div class="flex justify-end gap-2 flex-wrap">
        <Button onclick={() => onDecide('cancel')}>Cancel</Button>
        <Button onclick={() => onDecide('never')}>Never</Button>
        <Button onclick={() => onDecide('allow_always')}>Always allow</Button>
        <Button
          onclick={() => onDecide('allow_once')}
          class="btn-confirm-primary"
        >
          Allow once
        </Button>
      </div>
    </div>
  </div>
</div>

<style>
  .dialog-backdrop {
    background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
    backdrop-filter: blur(8px);
  }

  :global(html[data-platform='linux']) .dialog-backdrop {
    backdrop-filter: none;
    background: var(--bg-popup);
  }

  :global(.btn-confirm-primary) {
    background: var(--accent-primary) !important;
    color: white !important;
    border: none !important;
  }

  :global(.btn-confirm-primary:hover) {
    opacity: 0.9;
  }
</style>
