<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { calculatorState } from "./state.svelte";
  import { TabGroup } from "../../components";

  import MathTab from "./tabs/MathTab.svelte";
  import UnitsTab from "./tabs/UnitsTab.svelte";
  import CurrencyTab from "./tabs/CurrencyTab.svelte";
  import DateTab from "./tabs/DateTab.svelte";
  import BaseTab from "./tabs/BaseTab.svelte";

  import { evaluateMath } from "./engine/math";
  import { convertUnit } from "./engine/units";
  import { convertCurrency, getCurrencyCacheAge } from "./engine/currency";
  import { addDays, subtractDays, daysBetween } from "./engine/datetime";
  import { convertBase } from "./engine/bases";

  const tabList = [
    { id: 'Calculator', label: 'Calculator' },
    { id: 'Units', label: 'Units' },
    { id: 'Currency', label: 'Currency' },
    { id: 'Date', label: 'Date' },
    { id: 'Base', label: 'Base' },
  ];

  let activeTab = $state<string>("Calculator");

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
    window.removeEventListener("calculator-action-copy", handleActionCopy);
    window.removeEventListener("calculator-action-clear", handleActionClear);
    window.removeEventListener("keydown", keydownHandler);
  });
</script>

<div class="view-container calculator-view">

  <!-- Ambient glow blobs -->
  <div class="calc-glow calc-glow-1"></div>
  <div class="calc-glow calc-glow-2"></div>

  <!-- Tab navigation -->
  <TabGroup tabs={tabList} bind:activeTab={activeTab} variant="pills" />

  <!-- Tab content -->
  <div class="calc-content">
    {#if activeTab === "Calculator"}
      <MathTab bind:mathInput bind:history {mathResult} />
    {:else if activeTab === "Units"}
      <UnitsTab bind:unitValue bind:unitFrom bind:unitTo {unitResult} />
    {:else if activeTab === "Currency"}
      <CurrencyTab bind:currencyValue bind:currencyFrom bind:currencyTo {currencyResult} {currencyAge} />
    {:else if activeTab === "Date"}
      <DateTab bind:dateOp bind:dateA bind:dateB bind:dateDays {dateResult} />
    {:else if activeTab === "Base"}
      <BaseTab bind:baseInput {baseResult} />
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
    border-radius: var(--radius-full);
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
    margin-top: 32px;
  }
</style>
