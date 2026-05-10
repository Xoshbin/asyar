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
  .bubble { padding: 8px 12px; border-radius: 8px; max-width: 80%; }
  .bubble-user { background: var(--accent-primary); color: white; align-self: flex-end; }
  .bubble-assistant { background: var(--bg-secondary); color: var(--text-primary); align-self: flex-start; }
  .bubble-tool { background: var(--bg-tertiary, #1a1a1a); color: var(--text-secondary, #aaa); font-family: monospace; align-self: flex-start; }
  .bubble-label { font-size: 11px; opacity: 0.7; margin-bottom: 4px; }
  .tool-result, .chip-input { white-space: pre-wrap; word-break: break-word; margin: 0; }
  .tool-use-chip { margin-top: 8px; padding: 4px 6px; background: rgba(255,255,255,0.05); border-radius: 4px; font-size: 12px; }
  .chip-name { font-weight: bold; }
</style>
