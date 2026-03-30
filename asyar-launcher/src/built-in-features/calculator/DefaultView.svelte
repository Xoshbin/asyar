<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { calculatorState } from "./state.svelte";
  import ResultDisplay from "./components/ResultDisplay.svelte";
  import { StatusDot } from "../../components";

  import { evaluateMath } from "./engine/math";
  import { convertUnit } from "./engine/units";
  import { convertCurrency, getCurrencyCacheAge } from "./engine/currency";
  import { addDays, subtractDays, daysBetween } from "./engine/datetime";
  import { convertBase } from "./engine/bases";

  type Tab = "Calculator" | "Units" | "Currency" | "Date" | "Base";
  let activeTab = $state<Tab>("Calculator");

  // State refs
  let mathInput = $state("");
  let history = $state<string[]>([]);
  let mathResult = $derived(evaluateMath(mathInput) || "");

  let unitValue = $state(1);
  let unitFrom = $state("km");
  let unitTo = $state("miles");
  let unitResult = $derived(convertUnit(unitValue, unitFrom, unitTo) || "");

  let currencyValue = $state(1);
  let currencyFrom = $state("USD");
  let currencyTo = $state("EUR");
  let currencyResult = $state("");
  let currencyAge = $state("");
  $effect(() => {
    convertCurrency(currencyValue, currencyFrom, currencyTo).then(res => {
      currencyResult = res || "";
      const ageTimestamp = getCurrencyCacheAge();
      currencyAge = ageTimestamp > 0 
        ? new Date(ageTimestamp).toLocaleTimeString() 
        : "Fetching...";
    });
  });

  let dateOp = $state("between");
  let dateA = $state("");
  let dateB = $state("");
  let dateDays = $state(0);
  let dateResult = $derived.by(() => {
    if (dateOp === "between") return daysBetween(dateA, dateB) || "";
    if (dateOp === "add") return addDays(dateA, dateDays) || "";
    if (dateOp === "sub") return subtractDays(dateA, dateDays) || "";
    return "";
  });

  let baseInput = $state("");
  let baseResult = $derived(convertBase(baseInput) || "");

  let currentResult = $derived.by(() => {
    switch (activeTab) {
      case "Calculator": return mathResult;
      case "Units": return unitResult;
      case "Currency": return currencyResult;
      case "Date": return dateResult;
      case "Base": return baseResult;
      default: return "";
    }
  });

  function handleActionCopy() {
    if (currentResult) {
       navigator.clipboard.writeText(currentResult);
       if (activeTab === "Calculator" && mathInput) {
         history = [`${mathInput} = ${currentResult}`, ...history].slice(0, 20);
       }
    }
  }

  function handleActionClear() {
    if (activeTab === "Calculator") mathInput = "";
    if (activeTab === "Base") baseInput = "";
  }

  function keydownHandler(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleActionCopy();
    }
  }

  function autofocusAction(node: HTMLElement) {
    if (node && typeof node.focus === "function") {
      setTimeout(() => node.focus(), 0);
    }
  }

  function focusSignal(node: HTMLElement) {
    const focus = () => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, window.location.origin);
    const blur = () => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, window.location.origin);
    node.addEventListener('focus', focus);
    node.addEventListener('blur', blur);
    return {
      destroy: () => {
        node.removeEventListener('focus', focus);
        node.removeEventListener('blur', blur);
      }
    };
  }

  // No manual subscription needed with Svelte 5

  onMount(() => {
    $effect(() => {
      const q = calculatorState.lastQuery;
      if (q) {
        mathInput = q;
        baseInput = q;
        // Basic parser for quick view routing when entered from query pre-fill
        if (q.match(/\b(to|in)\b/i) && activeTab === "Calculator") {
           if (q.match(/\b(hex|binary|oct|0x|0b)\b/i)) activeTab = "Base";
           else if (q.match(/\b(km|mile|kg|lb|celsius|f)\b/i)) activeTab = "Units";
           else if (q.match(/\b(usd|eur|gbp)\b/i)) activeTab = "Currency";
           else if (q.match(/\b(?:days|today|-)\b/i)) activeTab = "Date";
        }
      }
    });

    window.addEventListener("calculator-action-copy", handleActionCopy);
    window.addEventListener("calculator-action-clear", handleActionClear);
    window.addEventListener("keydown", keydownHandler);
  });

  onDestroy(() => {
    // Svelte 5 $effects are auto-cleaned
    window.removeEventListener("calculator-action-copy", handleActionCopy);
    window.removeEventListener("calculator-action-clear", handleActionClear);
    window.removeEventListener("keydown", keydownHandler);
  });
</script>

<div class="view-container calculator-view">

  <!-- Subtle Gradient Background Overlays -->
  <div class="calc-glow calc-glow-1"></div>
  <div class="calc-glow calc-glow-2"></div>

  <!-- Dashboard Header / Tabs -->
  <div class="calc-tabs custom-scrollbar">
    {#each ["Calculator", "Units", "Currency", "Date", "Base"] as tab}
      <button
        class="calc-tab {activeTab === tab ? 'active' : ''}"
        onclick={() => activeTab = tab as Tab}
      >
        {tab}
      </button>
    {/each}
  </div>

  <!-- Application Content Frame -->
  <div class="calc-content">

    {#if activeTab === "Calculator"}
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

    {:else if activeTab === "Units"}
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

    {:else if activeTab === "Currency"}
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

    {:else if activeTab === "Date"}
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

    {:else if activeTab === "Base"}
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
    {/if}
  </div>
</div>

<style>
  .calculator-view {
    position: relative;
    overflow: hidden;
  }

  /* ── Ambient glow blobs ───────────────────────────── */
  .calc-glow {
    position: absolute;
    border-radius: 9999px;
    pointer-events: none;
  }
  .calc-glow-1 {
    top: -10%; left: -10%; width: 40%; height: 40%;
    background: color-mix(in srgb, var(--accent-primary) 5%, transparent);
    filter: blur(100px);
  }
  .calc-glow-2 {
    bottom: -10%; right: -10%; width: 50%; height: 50%;
    background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
    filter: blur(120px);
  }

  /* ── Tabs ──────────────────────────────────────────── */
  .calc-tabs {
    position: relative;
    z-index: 10;
    display: flex;
    gap: 8px;
    border-bottom: 1px solid var(--separator);
    padding-bottom: 16px;
    overflow-x: auto;
  }
  .calc-tab {
    padding: 10px 20px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all 200ms ease;
    transform: scale(1);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-family: var(--font-ui);
  }
  .calc-tab:hover {
    background: var(--bg-hover);
    transform: scale(1.05);
  }
  .calc-tab:active { transform: scale(0.95); }
  .calc-tab.active {
    background: var(--accent-primary);
    color: #fff;
    box-shadow: 0 4px 6px -1px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }

  /* ── Content frame ─────────────────────────────────── */
  .calc-content {
    position: relative;
    z-index: 10;
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 24px;
    width: 100%;
    max-width: 56rem;
    margin: 0 auto;
  }

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
    font-size: 2.25rem;
    font-weight: 300;
    padding: 24px;
    text-align: center;
    letter-spacing: 0.05em;
    color: var(--text-primary);
    transition: all var(--transition-normal);
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
    font-size: 12px;
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
    border-radius: 9999px;
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
    font-size: 13px;
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

  /* ── Panel (Units / Currency / Date / Base cards) ──── */
  .calc-panel { padding: 32px; }
  .calc-panel-col {
    display: flex;
    flex-direction: column;
    gap: 32px;
    width: 100%;
  }

  /* ── Field row (flex row of inputs) ────────────────── */
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
  .calc-field-label-lg { margin-bottom: 12px; }

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

  /* ── Dividers ──────────────────────────────────────── */
  .calc-divider {
    margin-top: 32px;
    padding-top: 24px;
    border-top: 1px solid var(--separator);
  }
  .calc-divider-sm {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--separator);
  }
  .calc-result-inline { margin-top: 8px; }

  /* ── Currency status dot ───────────────────────────── */
  .calc-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 16px;
    margin-left: 8px;
  }
  .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: var(--radius-xs);
  }
</style>
