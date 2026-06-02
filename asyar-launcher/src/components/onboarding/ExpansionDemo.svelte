<script lang="ts">
  let { trigger, result, note = '' }: { trigger: string; result: string; note?: string } = $props()
</script>

<div class="demo">
  <div class="demo__row">
    <code class="demo__trigger">{trigger}</code>
    <span class="demo__arrow">→</span>
    <span class="demo__result">{result}</span>
  </div>
  {#if note}<p class="demo__note">{note}</p>{/if}
</div>

<style>
  .demo { border: 1px solid var(--separator); border-radius: var(--radius-md); padding: var(--space-3); background: var(--bg-subtle); }
  .demo__row { display: flex; align-items: center; gap: var(--space-3); }
  .demo__trigger { font-family: var(--font-mono); background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 2px 8px; color: var(--text-primary); }
  .demo__arrow { color: var(--text-tertiary); }
  .demo__result { font-size: var(--font-size-lg); }
  .demo__note { margin: var(--space-2) 0 0; font-size: var(--font-size-sm); color: var(--text-secondary); }
</style>
