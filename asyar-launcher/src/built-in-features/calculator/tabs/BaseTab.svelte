<script lang="ts">
  import ResultDisplay from "../components/ResultDisplay.svelte";
  import { focusSignal } from "../actions";

  let {
    baseInput = $bindable(''),
    baseResult,
  }: {
    baseInput: string;
    baseResult: string;
  } = $props();
</script>

<div class="card card-elevated calc-panel">
  <span class="text-label uppercase calc-field-label calc-field-label-lg">Programmer Input</span>
  <input
    type="text"
    bind:value={baseInput}
    placeholder="e.g. 255 in hex, 0xFF, 0b1010"
    use:focusSignal
    class="field-input calc-base-input"
  />
  {#if baseResult}
    <div class="calc-divider">
       <ResultDisplay value={baseResult} />
    </div>
  {/if}
</div>

<style>
  /* ── Panel ────────────────────────────────────────── */
  .calc-panel { padding: 32px; }

  /* ── Field label ───────────────────────────────────── */
  .calc-field-label {
    display: block;
    margin-bottom: 8px;
    margin-left: 4px;
  }
  .calc-field-label-lg { margin-bottom: 12px; }

  /* ── Base input ────────────────────────────────────── */
  .calc-base-input {
    width: 100%;
    font-size: 1.5rem;
    padding: 16px;
    font-family: var(--font-mono);
  }

  /* ── Divider ──────────────────────────────────────── */
  .calc-divider {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--separator);
  }
</style>
