<script lang="ts">
  import Modal from '../../components/base/Modal.svelte';
  import Button from '../../components/base/Button.svelte';
  import { mcpService } from './mcpService.svelte';
  import { agentService } from '../agents/agentService.svelte';
  import { t } from '../../services/i18n';

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
  //
  // `McpServerSummary` only carries `toolsCount`, so the descriptors have to be
  // fetched. They are keyed by tool name, which is what `toolId` holds.
  let toolDescription = $state('');

  $effect(() => {
    const requestedServer = serverId;
    const requestedTool = toolId;
    let cancelled = false;
    void mcpService
      .listServerTools(requestedServer)
      .then((tools) => {
        if (cancelled) return;
        toolDescription = tools?.find((tool) => tool.name === requestedTool)?.description ?? '';
      })
      .catch(() => {
        if (!cancelled) toolDescription = '';
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<Modal
  isOpen={true}
  labelledBy="mcp-permission-title"
  onEscape={() => onDecide('cancel')}
  onEnter={() => onDecide('allow_once')}
>
  {#snippet children()}
    <h2 id="mcp-permission-title" class="text-xl font-semibold mb-4 text-[var(--text-primary)]">
      Allow MCP tool call?
    </h2>
    <p class="text-[var(--text-secondary)] mb-3">
      <strong>{agentLabel}</strong> wants to call
      <code class="font-mono text-sm">{toolId}</code>
      on <strong>{serverLabel}</strong>.
    </p>
    {#if toolDescription}
      <p class="text-[var(--text-secondary)] text-sm italic">
        {toolDescription}
      </p>
    {:else}
      <p class="text-[var(--text-secondary)] text-sm italic">
        No description provided by the server.
      </p>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button onclick={() => onDecide('cancel')}>{t('common.cancel')}</Button>
    <Button onclick={() => onDecide('never')}>{t('common.never')}</Button>
    <Button onclick={() => onDecide('allow_always')}>{t('common.always_allow')}</Button>
    <Button autofocus onclick={() => onDecide('allow_once')} class="btn-confirm-primary">
      {t('common.allow_once')}
    </Button>
  {/snippet}
</Modal>

<style>
  :global(.btn-confirm-primary) {
    background: var(--accent-primary-fill) !important;
    color: var(--text-on-accent) !important;
    border: none !important;
  }

  :global(.btn-confirm-primary:hover) {
    opacity: 0.9;
  }
</style>
