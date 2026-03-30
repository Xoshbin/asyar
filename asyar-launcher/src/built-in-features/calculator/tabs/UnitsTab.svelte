<script lang="ts">
  import ResultDisplay from "../components/ResultDisplay.svelte";
  import { focusSignal } from "../actions";

  let {
    unitValue = $bindable(1),
    unitFrom = $bindable('km'),
    unitTo = $bindable('miles'),
    unitResult,
  }: {
    unitValue: number;
    unitFrom: string;
    unitTo: string;
    unitResult: string;
  } = $props();
</script>

<div class="card card-elevated calc-panel">
  <div class="calc-field-row">
    <div class="flex-1 w-full">
       <span class="text-label uppercase calc-field-label">Value</span>
       <input type="number" bind:value={unitValue} use:focusSignal class="field-input calc-input-lg" />
    </div>
    <div class="w-full sm:w-1/3">
       <span class="text-label uppercase calc-field-label">From</span>
       <input type="text" bind:value={unitFrom} use:focusSignal placeholder="e.g. km" class="field-input calc-input-md" />
    </div>
    <span class="calc-arrow">➔</span>
    <div class="w-full sm:w-1/3">
       <span class="text-label uppercase calc-field-label">To</span>
       <input type="text" bind:value={unitTo} use:focusSignal placeholder="e.g. miles" class="field-input calc-input-md" />
    </div>
  </div>
  {#if unitResult}
    <div class="calc-divider">
      <ResultDisplay value={unitResult} />
    </div>
  {/if}
</div>

<style>
  /* ── Panel ────────────────────────────────────────── */
  .calc-panel { padding: 32px; }

  /* ── Field row ────────────────────────────────────── */
  .calc-field-row {
    display: flex;
    flex-direction: column;
    gap: 24px;
    align-items: center;
    width: 100%;
  }
  @media (min-width: 640px) {
    .calc-field-row { flex-direction: row; }
  }

  /* ── Field label ───────────────────────────────────── */
  .calc-field-label {
    display: block;
    margin-bottom: 8px;
    margin-left: 4px;
  }

  /* ── Input sizes ───────────────────────────────────── */
  .calc-input-lg {
    width: 100%;
    font-size: 1.875rem;
    padding: 16px;
    transition: all var(--transition-normal);
  }
  .calc-input-md {
    width: 100%;
    font-size: 1.25rem;
    padding: 16px;
    transition: all var(--transition-normal);
  }

  /* ── Arrow separator (➔) ───────────────────────────── */
  .calc-arrow {
    display: none;
    color: var(--text-tertiary);
    font-size: 1.875rem;
    font-weight: 300;
    margin-top: 24px;
  }
  @media (min-width: 640px) {
    .calc-arrow { display: block; }
  }

  /* ── Divider ──────────────────────────────────────── */
  .calc-divider {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--separator);
  }
</style>
