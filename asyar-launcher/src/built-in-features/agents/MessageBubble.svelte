<script lang="ts">
  import type { MessageDef } from './types';
  import { extractTextFromMessage, extractToolUsesFromMessage, messageBubbleVariant } from './agentChatView.helpers';
  import { renderMarkdown } from '../../utils/markdown';

  let { message }: { message: MessageDef } = $props();

  const variant = $derived(messageBubbleVariant(message));
  const text = $derived(extractTextFromMessage(message));
  const toolUses = $derived(extractToolUsesFromMessage(message));
  const html = $derived(text.length > 0 ? renderMarkdown(text) : '');
</script>

<div class="bubble bubble-{variant}">
  {#if variant === 'tool'}
    <div class="bubble-label">Tool result</div>
    <pre class="tool-result">{text}</pre>
  {:else}
    <div class="bubble-label">{variant === 'user' ? 'You' : 'Assistant'}</div>
    {#if html}<div class="bubble-text">{@html html}</div>{/if}
    {#each toolUses as tu (tu.id)}
      <div class="tool-use-chip">
        <span class="chip-name">{tu.name}</span>
        <pre class="chip-input">{JSON.stringify(tu.input, null, 2)}</pre>
      </div>
    {/each}
  {/if}
</div>

<style>
  .bubble { padding: var(--space-3) var(--space-5); border-radius: var(--radius-md); max-width: 80%; }
  .bubble-user { background: var(--accent-primary); color: white; align-self: flex-end; }
  .bubble-assistant { background: var(--bg-secondary); color: var(--text-primary); align-self: flex-start; }
  .bubble-tool { background: var(--bg-tertiary); color: var(--text-secondary); font-family: var(--font-mono); align-self: flex-start; }
  .bubble-label { font-size: var(--font-size-xs); opacity: 0.7; margin-bottom: var(--space-1); }
  .tool-result, .chip-input { white-space: pre-wrap; word-break: break-word; margin: 0; }
  .tool-use-chip { margin-top: var(--space-3); padding: var(--space-1) var(--space-2); background: var(--bg-hover); border-radius: var(--radius-xs); font-size: var(--font-size-sm); }
  .chip-name { font-weight: 600; }
</style>
