<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { lastCalculatorQuery } from "./state";
  import ResultDisplay from "./components/ResultDisplay.svelte";

  import { evaluateMath } from "./engine/math";
  import { convertUnit } from "./engine/units";
  import { convertCurrency, getCurrencyCacheAge } from "./engine/currency";
  import { addDays, subtractDays, daysBetween } from "./engine/datetime";
  import { convertBase } from "./engine/bases";

  type Tab = "Calculator" | "Units" | "Currency" | "Date" | "Base";
  let activeTab: Tab = "Calculator";

  // State refs
  let mathInput = "";
  let mathResult = "";
  let history: string[] = [];
  $: { mathResult = evaluateMath(mathInput) || ""; }

  let unitValue = 1;
  let unitFrom = "km";
  let unitTo = "miles";
  let unitResult = "";
  $: { unitResult = convertUnit(unitValue, unitFrom, unitTo) || ""; }

  let currencyValue = 1;
  let currencyFrom = "USD";
  let currencyTo = "EUR";
  let currencyResult = "";
  let currencyAge = "";
  $: {
    convertCurrency(currencyValue, currencyFrom, currencyTo).then(res => {
      currencyResult = res || "";
      const ageTimestamp = getCurrencyCacheAge();
      currencyAge = ageTimestamp > 0 
        ? new Date(ageTimestamp).toLocaleTimeString() 
        : "Fetching...";
    });
  }

  let dateOp = "between";
  let dateA = "";
  let dateB = "";
  let dateDays = 0;
  let dateResult = "";
  $: {
    if (dateOp === "between") dateResult = daysBetween(dateA, dateB) || "";
    if (dateOp === "add") dateResult = addDays(dateA, dateDays) || "";
    if (dateOp === "sub") dateResult = subtractDays(dateA, dateDays) || "";
  }

  let baseInput = "";
  let baseResult = "";
  $: { baseResult = convertBase(baseInput) || ""; }

  $: currentResult = (() => {
    switch (activeTab) {
      case "Calculator": return mathResult;
      case "Units": return unitResult;
      case "Currency": return currencyResult;
      case "Date": return dateResult;
      case "Base": return baseResult;
      default: return "";
    }
  })();

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

  let unsub: () => void;

  onMount(() => {
    unsub = lastCalculatorQuery.subscribe(q => {
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
    if (unsub) unsub();
    window.removeEventListener("calculator-action-copy", handleActionCopy);
    window.removeEventListener("calculator-action-clear", handleActionClear);
    window.removeEventListener("keydown", keydownHandler);
  });
</script>

<div class="calculator-view p-6 min-h-full flex flex-col gap-6 w-full text-gray-900 dark:text-gray-100">

  <!-- Tabs Navigation -->
  <div class="flex gap-4 border-b border-gray-200 dark:border-gray-800 pb-2">
    {#each ["Calculator", "Units", "Currency", "Date", "Base"] as tab}
      <button 
        class="pb-2 px-1 text-sm font-medium transition-colors border-b-2 {activeTab === tab ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-300'}"
        on:click={() => activeTab = tab as Tab}
      >
        {tab}
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  <div class="flex-grow flex flex-col gap-4">
    
    {#if activeTab === "Calculator"}
      <input 
        type="text" 
        bind:value={mathInput} 
        placeholder="Enter math expression (e.g. 2 * (3 + 4))"
        use:autofocusAction
        class="w-full text-xl p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
      />
      {#if mathResult}
        <ResultDisplay value={mathResult} />
      {/if}

      {#if history.length > 0}
        <div class="mt-8">
          <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">History</h3>
          <ul class="space-y-2 font-mono text-sm max-h-60 overflow-y-auto">
            {#each history as item}
              <li class="p-3 bg-gray-50 dark:bg-gray-800 rounded">{item}</li>
            {/each}
          </ul>
        </div>
      {/if}

    {:else if activeTab === "Units"}
      <div class="flex gap-4 items-center">
        <input type="number" bind:value={unitValue} class="flex-1 p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 outline-none" />
        <input type="text" bind:value={unitFrom} placeholder="From (e.g. km)" class="w-32 p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 outline-none" />
        <span class="text-gray-500 font-medium">to</span>
        <input type="text" bind:value={unitTo} placeholder="To (e.g. miles)" class="w-32 p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 outline-none" />
      </div>
      {#if unitResult}
        <ResultDisplay value={unitResult} />
      {/if}

    {:else if activeTab === "Currency"}
      <div class="flex gap-4 items-center">
        <input type="number" bind:value={currencyValue} class="flex-1 p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 outline-none" />
        <input type="text" bind:value={currencyFrom} placeholder="USD" class="w-24 p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 uppercase outline-none" />
        <span class="text-gray-500 font-medium">to</span>
        <input type="text" bind:value={currencyTo} placeholder="EUR" class="w-24 p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 uppercase outline-none" />
      </div>
      <p class="text-xs text-gray-400 mt-2 font-medium">Rates last updated: {currencyAge}</p>
      {#if currencyResult}
        <ResultDisplay value={currencyResult} />
      {/if}

    {:else if activeTab === "Date"}
      <div class="flex flex-col gap-4 w-full">
        <select bind:value={dateOp} class="max-w-md p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 outline-none font-medium">
          <option value="between">Days between two dates</option>
          <option value="add">Add days to date</option>
          <option value="sub">Subtract days from date</option>
        </select>
        
        {#if dateOp === "between"}
          <div class="flex gap-4 items-center">
            <input type="date" bind:value={dateA} class="flex-1 p-3 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 rounded outline-none" />
            <span class="text-gray-500 font-medium">and</span>
            <input type="date" bind:value={dateB} class="flex-1 p-3 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 rounded outline-none" />
          </div>
        {:else}
          <div class="flex gap-4 items-center">
            <input type="date" bind:value={dateA} class="flex-1 p-3 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 rounded outline-none" />
            <span class="text-gray-500 font-medium">{dateOp === 'add' ? '+' : '-'}</span>
            <input type="number" bind:value={dateDays} class="w-24 p-3 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 rounded outline-none" />
            <span class="text-gray-500 font-medium">days</span>
          </div>
        {/if}
      </div>
      {#if dateResult}
        <ResultDisplay value={dateResult} />
      {/if}

    {:else if activeTab === "Base"}
      <input 
        type="text" 
        bind:value={baseInput} 
        placeholder="Enter number (e.g. 255 in hex, 0xFF, 0b1010)"
        class="w-full text-xl p-3 border border-gray-200 dark:border-gray-800 rounded bg-gray-50 dark:bg-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
      />
      {#if baseResult}
        <ResultDisplay value={baseResult} />
      {/if}
    {/if}
  </div>
</div>
