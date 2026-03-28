<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { calculatorState } from "./state.svelte";
  import ResultDisplay from "./components/ResultDisplay.svelte";

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

<div class="calculator-view p-8 min-h-full flex flex-col gap-8 w-full transition-all duration-300 relative overflow-hidden">
  
  <!-- Subtle Gradient Background Overlays -->
  <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none"></div>
  <div class="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[120px] pointer-events-none"></div>

  <!-- Dashboard Header / Tabs -->
  <div class="relative z-10 flex gap-2 border-b border-[var(--separator)] pb-4 overflow-x-auto custom-scrollbar">
    {#each ["Calculator", "Units", "Currency", "Date", "Base"] as tab}
      <button 
        class="px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 transform hover:scale-105 active:scale-95 {activeTab === tab ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-md shadow-blue-500/20' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
        on:click={() => activeTab = tab as Tab}
      >
        {tab}
      </button>
    {/each}
  </div>

  <!-- Application Content Frame -->
  <div class="relative z-10 flex-grow flex flex-col gap-6 w-full max-w-4xl mx-auto">
    
    {#if activeTab === "Calculator"}
      <div class="card card-elevated flex flex-col gap-4 relative isolate">
        <div class="absolute inset-0 bg-gradient-to-br from-white/40 to-white/10 dark:from-white/5 dark:to-white/0 rounded-[var(--border-radius-lg)] rounded-[12px] -z-10 backdrop-blur-3xl"></div>
        <input 
          type="text" 
          bind:value={mathInput} 
          placeholder="Enter math expression (e.g. 2 * (3 + 4))"
          use:autofocusAction
          use:focusSignal
          class="w-full text-4xl font-light p-6 rounded-2xl bg-transparent border-0 border-b-2 border-transparent hover:border-[var(--border-color)] focus:border-[var(--accent-primary)] focus:ring-0 transition-all outline-none text-center tracking-wider text-[var(--text-primary)] placeholder-opacity-30"
        />
        {#if mathResult}
          <div class="mx-auto transform scale-110 mt-2 mb-4">
             <ResultDisplay value={mathResult} />
          </div>
        {/if}
      </div>

      {#if history.length > 0}
        <div class="mt-4 px-2">
          <h3 class="text-xs font-bold text-[var(--accent-primary)] uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
             <span class="w-2 h-2 rounded-full bg-[var(--accent-primary)] animate-pulse"></span> Calculation History
          </h3>
          <ul class="space-y-3 font-mono text-sm max-h-56 overflow-y-auto pr-2 custom-scrollbar">
            {#each history as item}
              <li class="p-4 bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-color)]/30 hover:bg-[var(--bg-hover)] transition-colors opacity-80 hover:opacity-100 flex items-center group cursor-default">
                  <span class="text-gray-400 group-hover:text-blue-400 mr-3 transition-colors">▶</span>
                  {item}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

    {:else if activeTab === "Units"}
      <div class="card card-elevated p-8">
        <div class="flex flex-col sm:flex-row gap-6 items-center w-full">
          <div class="flex-1 w-full">
             <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">Value</span>
             <input type="number" bind:value={unitValue} use:focusSignal class="w-full text-3xl p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] focus:border-[var(--accent-primary)] transition-all outline-none" />
          </div>
          <div class="w-full sm:w-1/3">
             <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">From</span>
             <input type="text" bind:value={unitFrom} use:focusSignal placeholder="e.g. km" class="w-full text-xl p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-all outline-none focus:border-[var(--accent-primary)]" />
          </div>
          <span class="hidden sm:block text-[var(--text-tertiary)] text-3xl font-light mt-6">➔</span>
          <div class="w-full sm:w-1/3">
             <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">To</span>
             <input type="text" bind:value={unitTo} use:focusSignal placeholder="e.g. miles" class="w-full text-xl p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-all outline-none focus:border-[var(--accent-primary)]" />
          </div>
        </div>
        {#if unitResult}
          <div class="mt-8 pt-6 border-t border-[var(--separator)]">
            <ResultDisplay value={unitResult} />
          </div>
        {/if}
      </div>

    {:else if activeTab === "Currency"}
      <div class="card card-elevated p-8">
        <div class="flex flex-col sm:flex-row gap-6 items-center w-full">
          <div class="flex-1 w-full">
             <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">Amount</span>
             <input type="number" bind:value={currencyValue} use:focusSignal class="w-full text-3xl p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] focus:border-[var(--accent-primary)] transition-all outline-none" />
          </div>
          <div class="w-full sm:w-1/4">
             <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">From</span>
             <input type="text" bind:value={currencyFrom} use:focusSignal placeholder="USD" class="w-full text-2xl uppercase p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-all outline-none focus:border-[var(--accent-primary)]" />
          </div>
          <span class="hidden sm:block text-[var(--text-tertiary)] text-3xl font-light mt-6">➔</span>
          <div class="w-full sm:w-1/4">
             <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">To</span>
             <input type="text" bind:value={currencyTo} use:focusSignal placeholder="EUR" class="w-full text-2xl uppercase p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-all outline-none focus:border-[var(--accent-primary)]" />
          </div>
        </div>
        <div class="flex items-center gap-2 mt-4 ml-2">
           <span class="w-2 h-2 rounded-full {currencyAge.includes('Fetching') ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}"></span>
           <p class="text-xs text-[var(--text-secondary)] font-medium tracking-wide">Rates updated: {currencyAge}</p>
        </div>
        {#if currencyResult}
          <div class="mt-6 pt-6 border-t border-[var(--separator)]">
            <ResultDisplay value={currencyResult} />
          </div>
        {/if}
      </div>

    {:else if activeTab === "Date"}
      <div class="card card-elevated p-8 flex flex-col gap-8 w-full">
        <div>
          <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-3 ml-1">Operation Type</span>
          <select bind:value={dateOp} use:focusSignal class="w-full max-w-sm p-4 text-base border-2 border-[var(--separator)] text-[var(--text-primary)] rounded-xl bg-[var(--bg-tertiary)] outline-none font-medium focus:border-[var(--accent-primary)] transition-all cursor-pointer">
            <option value="between">Days between two dates</option>
            <option value="add">Add days to a date</option>
            <option value="sub">Subtract days from a date</option>
          </select>
        </div>
        
        <div class="flex flex-col sm:flex-row gap-6 items-center p-6 bg-[var(--bg-tertiary)]/50 rounded-2xl border border-[var(--separator)]/30 shadow-inner">
          {#if dateOp === "between"}
              <div class="flex-1 w-full">
                 <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">Start Date</span>
                 <input type="date" bind:value={dateA} use:focusSignal class="w-full p-4 border border-[var(--border-color)] bg-[var(--bg-primary)] rounded-xl shadow-sm outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 transition-all font-medium text-lg" />
              </div>
              <div class="px-2 text-center text-sm font-bold text-[var(--text-tertiary)] uppercase self-end mb-5">AND</div>
              <div class="flex-1 w-full">
                 <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">End Date</span>
                 <input type="date" bind:value={dateB} use:focusSignal class="w-full p-4 border border-[var(--border-color)] bg-[var(--bg-primary)] rounded-xl shadow-sm outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 transition-all font-medium text-lg" />
              </div>
          {:else}
              <div class="flex-1 w-full">
                 <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">Base Date</span>
                 <input type="date" bind:value={dateA} use:focusSignal class="w-full p-4 border border-[var(--border-color)] bg-[var(--bg-primary)] rounded-xl shadow-sm outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 transition-all font-medium text-lg" />
              </div>
              <div class="px-2 w-12 text-center text-3xl font-light text-[var(--accent-primary)] self-end mb-4">
                  {dateOp === 'add' ? '+' : '−'}
              </div>
              <div class="flex-1 w-full flex items-end gap-3">
                 <div class="flex-1 focus-within:ring-2 focus-within:ring-[var(--accent-primary)]/50 rounded-xl transition-all">
                    <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-2 ml-1">Days to {dateOp}</span>
                    <input type="number" bind:value={dateDays} use:focusSignal class="w-full p-4 border border-[var(--border-color)] bg-[var(--bg-primary)] rounded-xl shadow-sm outline-none font-medium text-lg" />
                 </div>
              </div>
          {/if}
        </div>
        
        {#if dateResult}
          <div class="mt-2">
            <ResultDisplay value={dateResult} />
          </div>
        {/if}
      </div>

    {:else if activeTab === "Base"}
      <div class="card card-elevated p-8">
        <span class="block text-xs font-bold text-[var(--text-secondary)] uppercase mb-4 ml-1">Programmer Input</span>
        <input 
          type="text" 
          bind:value={baseInput} 
          placeholder="e.g. 255 in hex, 0xFF, 0b1010"
          use:focusSignal
          class="w-full text-2xl font-mono p-5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--separator)] outline-none focus:border-[var(--accent-primary)] shadow-sm transition-all text-center tracking-widest text-[var(--text-primary)]"
        />
        {#if baseResult}
          <div class="mt-8 pt-6 border-t border-[var(--separator)]">
             <ResultDisplay value={baseResult} />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
