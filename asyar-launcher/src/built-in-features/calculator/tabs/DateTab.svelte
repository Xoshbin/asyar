<script lang="ts">
  import ResultDisplay from "../components/ResultDisplay.svelte";
  import { focusSignal } from "../actions";

  let {
    dateOp = $bindable('between'),
    dateA = $bindable(''),
    dateB = $bindable(''),
    dateDays = $bindable(0),
    dateResult,
  }: {
    dateOp: string;
    dateA: string;
    dateB: string;
    dateDays: number;
    dateResult: string;
  } = $props();
</script>

<div class="card card-elevated calc-panel calc-panel-col">
  <div>
    <span class="text-label uppercase calc-field-label calc-field-label-lg">Operation Type</span>
    <select bind:value={dateOp} use:focusSignal class="field-input calc-select">
      <option value="between">Days between two dates</option>
      <option value="add">Add days to a date</option>
      <option value="sub">Subtract days from a date</option>
    </select>
  </div>

  <div class="calc-date-panel">
    {#if dateOp === "between"}
        <div class="flex-1 w-full">
           <span class="text-label uppercase calc-field-label">Start Date</span>
           <input type="date" bind:value={dateA} use:focusSignal class="field-input calc-date-input" />
        </div>
        <div class="calc-date-connector">AND</div>
        <div class="flex-1 w-full">
           <span class="text-label uppercase calc-field-label">End Date</span>
           <input type="date" bind:value={dateB} use:focusSignal class="field-input calc-date-input" />
        </div>
    {:else}
        <div class="flex-1 w-full">
           <span class="text-label uppercase calc-field-label">Base Date</span>
           <input type="date" bind:value={dateA} use:focusSignal class="field-input calc-date-input" />
        </div>
        <div class="calc-operator">
            {dateOp === 'add' ? '+' : '−'}
        </div>
        <div class="flex-1 w-full flex items-end gap-3">
           <div class="calc-focus-ring">
              <span class="text-label uppercase calc-field-label">Days to {dateOp}</span>
              <input type="number" bind:value={dateDays} use:focusSignal class="field-input calc-date-input" />
           </div>
        </div>
    {/if}
  </div>

  {#if dateResult}
    <div class="calc-result-inline">
      <ResultDisplay value={dateResult} />
    </div>
  {/if}
</div>

<style>
  /* ── Panel ────────────────────────────────────────── */
  .calc-panel { padding: 32px; }
  .calc-panel-col {
    display: flex;
    flex-direction: column;
    gap: 32px;
    width: 100%;
  }

  /* ── Field label ───────────────────────────────────── */
  .calc-field-label {
    display: block;
    margin-bottom: 8px;
    margin-left: 4px;
  }
  .calc-field-label-lg { margin-bottom: 12px; }

  /* ── Date panel ────────────────────────────────────── */
  .calc-date-panel {
    display: flex;
    flex-direction: column;
    gap: 24px;
    align-items: center;
    width: 100%;
  }
  @media (min-width: 640px) {
    .calc-date-panel { flex-direction: row; }
  }

  .calc-date-connector {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
    font-weight: 600;
    margin-top: 24px;
  }

  .calc-date-input {
    width: 100%;
    padding: 12px 16px;
    font-size: var(--font-size-xl);
  }

  /* ── Operator ────────────────────────────────────── */
  .calc-operator {
    font-size: 2rem;
    color: var(--text-tertiary);
    margin-top: 24px;
  }

  .calc-focus-ring {
    width: 100%;
  }

  /* ── Select ──────────────────────────────────────── */
  .calc-select {
    width: 100%;
    padding: 12px 16px;
    font-size: var(--font-size-xl);
    appearance: none;
    background: var(--bg-tertiary);
  }

  /* ── Result inline ───────────────────────────────── */
  .calc-result-inline { margin-top: 8px; }
</style>
