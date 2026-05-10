<script lang="ts">
  import Button from '../../components/base/Button.svelte';
  import { mcpService } from './mcpService.svelte';

  let { serverId, toolId, agentId, onDecide } = $props<{
    serverId: string;
    toolId: string;
    agentId: string;
    onDecide: (decision: 'allow_once' | 'allow_always' | 'never' | 'cancel') => void;
  }>();

  const server = $derived(mcpService.servers.find((s) => s.id === serverId));
  const serverName = $derived(server?.displayName ?? serverId);
</script>

<div class="mcp-permission-overlay">
  <div class="mcp-permission-dialog">
    <h2>Allow MCP tool call?</h2>
    <p>
      Agent <strong>{agentId || 'anonymous'}</strong> wants to call
      <code>{toolId}</code> on <strong>{serverName}</strong>.
    </p>
    <p class="muted">This tool may modify data or execute commands.</p>
    <div class="actions">
      <Button onclick={() => onDecide('allow_once')}>Allow once</Button>
      <Button onclick={() => onDecide('allow_always')}>Always allow</Button>
      <Button onclick={() => onDecide('never')}>Never</Button>
      <Button onclick={() => onDecide('cancel')}>Cancel</Button>
    </div>
  </div>
</div>

<style>
  .mcp-permission-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: grid;
    place-items: center;
    z-index: 1000;
  }

  .mcp-permission-dialog {
    background: var(--bg-primary);
    border-radius: var(--radius-md);
    padding: var(--space-4, 24px);
    max-width: 480px;
    box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.2));
  }

  .actions {
    display: flex;
    gap: var(--space-2, 8px);
    margin-top: var(--space-3, 16px);
    flex-wrap: wrap;
  }

  .muted {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }

  code {
    background: var(--bg-tertiary);
    padding: 0 0.3em;
    border-radius: var(--radius-xs);
  }
</style>
