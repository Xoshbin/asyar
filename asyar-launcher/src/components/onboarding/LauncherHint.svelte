<script lang="ts">
  let { steps }: { steps: string[] } = $props()
</script>

<div class="lhint">
  <span class="lhint__badge">Try it in the launcher</span>
  <ol class="lhint__steps">
    {#each steps as step}<li>{step}</li>{/each}
  </ol>
</div>

<style>
  .lhint { display: flex; flex-direction: column; gap: var(--space-2); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: var(--space-3); background: var(--bg-subtle); }
  .lhint__badge { align-self: flex-start; font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--asyar-brand); }
  .lhint__steps { margin: 0; padding-left: var(--space-4); color: var(--text-secondary); font-size: var(--font-size-lg); line-height: 1.8; }
</style>
