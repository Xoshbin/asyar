<!--
  Show More bar HUD chips — Scripts / Agents aggregate run-state summary
  rendered on the LEFT side of the compact-mode show-more-bar (non-macOS).
  macOS renders an equivalent native NSView via platform::macos and gets
  its counts pushed through compactHudBridge.

  - Scripts chip:  [dev-tools icon] · N Active · N Done
  - Agents  chip:  [ai-chat icon]   · N Active · N Idle
  - A chip with zero active + zero done is omitted (not greyed).
  - When both chips are zero, this component renders nothing — the row
    falls back to the original "Show More ↓"-only layout.

  KEEP IN SYNC: the macOS counterpart is src-tauri/src/platform/macos.rs
  `mod show_more_bar` (`build_hud_chip` / `apply_huds`). Any label / token
  change here (Active / Done / Idle wording, icon symbol, dot colors) MUST
  land on both sides — there is no automatic mirror.
-->
<script lang="ts">
  import Icon from '../base/Icon.svelte';
  import StatusDot from '../base/StatusDot.svelte';
  import { runService } from '../../services/run/runService.svelte';
  import { aggregateKindCounts } from '../../services/launcher/itemStatusLogic';

  const counts = $derived(aggregateKindCounts(runService.active, runService.keptAgents));
  const scriptsVisible = $derived(counts.scripts.active > 0 || counts.scripts.done > 0);
  const agentsVisible  = $derived(counts.agents.active  > 0 || counts.agents.done  > 0);
</script>

<div class="show-more-bar-huds" role="group" aria-label="Active runs summary">
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
          <span class="hud-text">{counts.agents.done} Idle</span>
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .show-more-bar-huds {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    min-width: 0;
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
