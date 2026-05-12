<!--
  Compact-mode HUD: small chip row showing aggregate Active / Done counts
  per kind. Renders inside the 96-px compact-idle slot when at least one
  chip has non-zero counts; otherwise renders nothing so the compact panel
  looks identical to before this feature.

  - Scripts chip:  [dev-tools icon] · N Active · N Done
  - Agents chip:   [ai-chat icon]   · N Active · N Done
  - Icons mirror `searchResultMapper.runKindIcon()` for visual consistency
    with the corresponding run-item rows in the expanded list.
-->
<script lang="ts">
  import Icon from '../base/Icon.svelte';
  import StatusDot from '../base/StatusDot.svelte';
  import { runService } from '../../services/run/runService.svelte';
  import { aggregateKindCounts } from '../../services/launcher/itemStatusLogic';

  const counts = $derived(aggregateKindCounts(runService.active, runService.keptAgents));
  const scriptsVisible = $derived(counts.scripts.active > 0 || counts.scripts.done > 0);
  const agentsVisible  = $derived(counts.agents.active  > 0 || counts.agents.done  > 0);
  const anyVisible     = $derived(scriptsVisible || agentsVisible);
</script>

{#if anyVisible}
  <div class="compact-hud" role="group" aria-label="Active runs summary">
    {#if scriptsVisible}
      <div class="hud-chip">
        <Icon name="dev-tools" size={14} />
        {#if counts.scripts.active > 0}
          <span class="hud-pair">
            <StatusDot color="info" pulse size={6} />
            <span class="hud-text">{counts.scripts.active} Active</span>
          </span>
        {/if}
        {#if counts.scripts.done > 0}
          <span class="hud-pair">
            <StatusDot color="success" size={6} />
            <span class="hud-text">{counts.scripts.done} Done</span>
          </span>
        {/if}
      </div>
    {/if}

    {#if agentsVisible}
      <div class="hud-chip">
        <Icon name="ai-chat" size={14} />
        {#if counts.agents.active > 0}
          <span class="hud-pair">
            <StatusDot color="info" pulse size={6} />
            <span class="hud-text">{counts.agents.active} Active</span>
          </span>
        {/if}
        {#if counts.agents.done > 0}
          <span class="hud-pair">
            <StatusDot color="success" size={6} />
            <span class="hud-text">{counts.agents.done} Done</span>
          </span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .compact-hud {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    padding: 0 var(--space-4);
    height: 100%;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .hud-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--text-secondary);
  }
  .hud-pair {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hud-text {
    color: var(--text-secondary);
    white-space: nowrap;
  }
</style>
