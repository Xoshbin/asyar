<script lang="ts">
  import ResultDisplay from "../components/ResultDisplay.svelte";
  import { StatusDot } from "../../../components";
  import { focusSignal } from "../actions";

  let {
    currencyValue = $bindable(1),
    currencyFrom = $bindable('USD'),
    currencyTo = $bindable('EUR'),
    currencyResult,
    currencyAge,
  }: {
    currencyValue: number;
    currencyFrom: string;
    currencyTo: string;
    currencyResult: string;
    currencyAge: string;
  } = $props();
</script>

<div class="card card-elevated calc-panel">
  <div class="calc-field-row">
    <div class="flex-1 w-full">
       <span class="text-label uppercase calc-field-label">Amount</span>
       <input type="number" bind:value={currencyValue} use:focusSignal class="field-input calc-input-lg" />
    </div>
    <div class="w-full sm:w-1/4">
       <span class="text-label uppercase calc-field-label">From</span>
       <input type="text" bind:value={currencyFrom} use:focusSignal placeholder="USD" class="field-input calc-input-md calc-input-upper" />
    </div>
    <span class="calc-arrow">➔</span>
    <div class="w-full sm:w-1/4">
       <span class="text-label uppercase calc-field-label">To</span>
       <input type="text" bind:value={currencyTo} use:focusSignal placeholder="EUR" class="field-input calc-input-md calc-input-upper" />
    </div>
  </div>
  <div class="calc-status-row">
     <StatusDot color={currencyAge.includes('Fetching') ? 'warning' : 'success'} />
     <p class="text-caption calc-status-text">Rates updated: {currencyAge}</p>
  </div>
  {#if currencyResult}
    <div class="calc-divider-sm">
      <ResultDisplay value={currencyResult} />
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
  .calc-input-upper { text-transform: uppercase; }

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

  /* ── Status row ────────────────────────────────────── */
  .calc-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    margin-left: 8px;
  }
  .calc-status-text {
    margin: 0;
    color: var(--text-tertiary);
  }

  /* ── Divider ──────────────────────────────────────── */
  .calc-divider-sm {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--separator);
  }
</style>
