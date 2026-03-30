<script lang="ts">
  import ResultDisplay from "../components/ResultDisplay.svelte";
  import { autofocusAction, focusSignal } from "../actions";

  let {
    mathInput = $bindable(""),
    mathResult,
    history = $bindable<string[]>([]),
  }: {
    mathInput: string;
    mathResult: string;
    history: string[];
  } = $props();
</script>

<div class="card card-elevated calc-card">
  <div class="calc-card-overlay"></div>
  <input
    type="text"
    bind:value={mathInput}
    placeholder="Enter math expression (e.g. 2 * (3 + 4))"
    use:autofocusAction
    use:focusSignal
    class="field-input calc-display-input"
  />
  {#if mathResult}
    <div class="calc-result-wrap">
       <ResultDisplay value={mathResult} />
    </div>
  {/if}
</div>

{#if history.length > 0}
  <div class="calc-history-section">
    <h3 class="calc-history-header">
       <span class="calc-pulse-dot"></span> Calculation History
    </h3>
    <ul class="calc-history-list custom-scrollbar">
      {#each history as item}
        <li class="calc-history-item">
            <span class="calc-history-arrow">▶</span>
            {item}
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  /* ── Calculator card + overlay ──────────────────────── */
  .calc-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: relative;
    isolation: isolate;
  }
  .calc-card-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom right, color-mix(in srgb, #fff 5%, transparent), transparent);
    border-radius: var(--radius-lg);
    z-index: -1;
  }

  /* ── Main display input ────────────────────────────── */
  .calc-display-input {
    width: 100%;
    font-size: var(--font-size-display);
    font-weight: 300;
    padding: 24px;
    text-align: center;
    letter-spacing: 0.05em;
    color: var(--text-primary);
    transition: all var(--transition-normal);
    background: transparent;
    border: none;
    outline: none;
  }
  .calc-display-input::placeholder { opacity: 0.3; }

  /* ── Result wrapper ────────────────────────────────── */
  .calc-result-wrap {
    margin: 8px auto 16px;
    transform: scale(1.1);
  }

  /* ── History section ───────────────────────────────── */
  .calc-history-section { margin-top: 16px; padding: 0 8px; }
  .calc-history-header {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .calc-pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    background: var(--accent-primary);
    animation: calc-pulse 1.5s ease-in-out infinite;
  }
  @keyframes calc-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .calc-history-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-family: var(--font-mono);
    font-size: var(--font-size-md);
    max-height: 14rem;
    overflow-y: auto;
    padding-right: 8px;
  }
  .calc-history-item {
    padding: 16px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-xl);
    border: 1px solid color-mix(in srgb, var(--border-color) 30%, transparent);
    display: flex;
    align-items: center;
    cursor: default;
    transition: background var(--transition-fast);
  }
  .calc-history-item:hover { background: var(--bg-hover); }
  .calc-history-arrow {
    color: var(--text-tertiary);
    margin-right: 12px;
    transition: color var(--transition-fast);
  }
  .calc-history-item:hover .calc-history-arrow { color: var(--accent-primary); }
</style>
