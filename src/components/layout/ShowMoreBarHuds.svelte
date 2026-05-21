<!--
  Show More bar HUD — single aggregate run-state summary rendered on the
  LEFT side of the compact-mode show-more-bar (non-macOS). macOS renders an
  equivalent native NSView via platform::macos and gets its counts pushed
  through compactHudBridge.

  Layout: [green dot] Done <b>N</b> · [blue pulsing dot] Active <b>N</b>
  - Done comes first (left), Active second (right). The number is bolder
    than the label so the count is the thing your eye lands on.
  - Each pair is omitted when its count is zero (not greyed).
  - When both counts are zero this component renders nothing — the row
    falls back to the original "Show More ↓"-only layout.

  KEEP IN SYNC: the macOS counterpart is src-tauri/src/platform/macos.rs
  `mod show_more_bar` (`build_hud_chip` / `apply_huds`). Any label / dot
  ordering / color change here MUST land on both sides — there is no
  automatic mirror.
-->
<script lang="ts">
  import StatusDot from '../base/StatusDot.svelte';
  import { runService } from '../../services/run/runService.svelte';
  import { aggregateKindCounts } from '../../services/launcher/itemStatusLogic';

  const counts = $derived(aggregateKindCounts(
    runService.active,
    runService.keptAgents,
    runService.unacknowledgedScriptResults,
  ));
  const visible = $derived(counts.active > 0 || counts.done > 0);
</script>

{#if visible}
  <div class="show-more-bar-huds" role="group" aria-label="Active runs summary">
    {#if counts.done > 0}
      <span class="hud-pair">
        <StatusDot color="success" size={6} />
        <span class="hud-text">Done</span>
        <span class="hud-count">{counts.done}</span>
      </span>
    {/if}
    {#if counts.done > 0 && counts.active > 0}
      <span aria-hidden="true" class="hud-separator"></span>
    {/if}
    {#if counts.active > 0}
      <span class="hud-pair">
        <StatusDot color="info" pulse size={6} />
        <span class="hud-text">Active</span>
        <span class="hud-count">{counts.active}</span>
      </span>
    {/if}
  </div>
{/if}

<style>
  .show-more-bar-huds {
    display: flex;
    align-items: center;
    /* --space-7 (20px) either side of the separator matches the Figma spec
       and gives the dividers more breathing room than the dot-to-label gap
       below. */
    gap: var(--space-7);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    min-width: 0;
  }
  .hud-pair {
    display: inline-flex;
    align-items: center;
    /* 6px gap applies between all three children: dot → label → count. */
    gap: var(--space-2);
  }
  .hud-text {
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .hud-count {
    color: var(--text-primary);
    font-weight: 600;
  }
  /* Matches `.bottom-bar-separator` in BottomActionBar.svelte so both
     separators share the same visual language. */
  .hud-separator {
    display: inline-block;
    width: 2px;
    height: 11px;
    border-radius: 1px;
    background-color: var(--separator);
    flex-shrink: 0;
  }
</style>
