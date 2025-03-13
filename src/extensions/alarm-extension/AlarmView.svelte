<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { alarmState, type Timer } from "./state";
  import { Button, Input, Card } from "../../components";
  import { format } from "date-fns";

  let newTimer = {
    hours: 0,
    minutes: 0,
    seconds: 0,
    message: ""
  };
  
  let activeTimers: Timer[] = [];
  let errorMessage = "";
  let interval: number;

  // Add string versions of the numeric fields for binding
  let hoursStr = "0";
  let minutesStr = "0";
  let secondsStr = "0";
  
  // Update the numeric values when string values change
  $: newTimer.hours = parseInt(hoursStr) || 0;
  $: newTimer.minutes = parseInt(minutesStr) || 0;
  $: newTimer.seconds = parseInt(secondsStr) || 0;
  
  // Active timers subscription
  $: activeTimers = $alarmState.timers
    .filter(timer => timer.active && timer.endsAt > Date.now())
    .sort((a, b) => a.endsAt - b.endsAt);

  // Add scroll position tracking
  let timerListContainer: HTMLElement;

  onMount(() => {
    // Update timers every second
    interval = window.setInterval(() => {
      // Force update to refresh countdown times
      activeTimers = [...activeTimers];
    }, 1000);

    // Check if any timers exist and scroll into view
    if (activeTimers.length > 0) {
      setTimeout(() => {
        if (timerListContainer) {
          timerListContainer.scrollTop = 0;
        }
      }, 100);
    }
  });
  
  onDestroy(() => {
    clearInterval(interval);
  });
  
  async function handleCreateTimer() {
    errorMessage = "";
    
    const totalSeconds = 
      (newTimer.hours * 3600) + 
      (newTimer.minutes * 60) + 
      newTimer.seconds;
    
    if (totalSeconds <= 0) {
      errorMessage = "Please set a time greater than zero";
      return;
    }

    try {
      await alarmState.createTimer(totalSeconds, newTimer.message || "Timer finished!");
      resetForm();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function resetForm() {
    hoursStr = "0";
    minutesStr = "0";
    secondsStr = "0";
    newTimer.message = "";
  }
  
  function formatTime(seconds: number): string {
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''}${minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? 's' : ''}` : ''}`;
  }
  
  function getTimeLeft(timer: Timer): string {
    const timeLeftMs = Math.max(0, timer.endsAt - Date.now());
    const seconds = Math.floor((timeLeftMs / 1000) % 60);
    const minutes = Math.floor((timeLeftMs / (1000 * 60)) % 60);
    const hours = Math.floor(timeLeftMs / (1000 * 60 * 60));
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  
  function cancelTimer(id: string) {
    alarmState.deleteTimer(id);
  }

  // Subscribe to state
  $: timers = $alarmState.timers;
  $: filtered = $alarmState.filtered;

  function formatEndTime(endsAt: number) {
    return format(endsAt, "HH:mm:ss");
  }

  function getRemainingTime(endsAt: number) {
    const remaining = endsAt - Date.now();
    if (remaining <= 0) return "Completed";
    
    const seconds = Math.floor(remaining / 1000);
    return formatTime(seconds);
  }

  function deleteTimer(id: string) {
    alarmState.deleteTimer(id);
  }
</script>

<div class="app-layout overflow-auto h-[calc(100vh-72px)]">
  <div class="p-6 max-w-4xl mx-auto">
    <h1 class="text-2xl font-bold mb-6 text-[var(--text-primary)]">Alarm & Timer</h1>
    
    <Card title="Create New Timer">
      <div class="grid grid-cols-3 gap-4 mb-4">
        <div>
          <label class="block text-sm mb-1 text-[var(--text-primary)]" for="hours">Hours</label>
          <Input 
            id="hours"
            type="number" 
            min="0"
            bind:value={hoursStr} 
          />
        </div>
        <div>
          <label class="block text-sm mb-1 text-[var(--text-primary)]" for="minutes">Minutes</label>
          <Input 
            id="minutes"
            type="number" 
            min="0" 
            max="59"
            bind:value={minutesStr} 
          />
        </div>
        <div>
          <label class="block text-sm mb-1 text-[var(--text-primary)]" for="seconds">Seconds</label>
          <Input 
            id="seconds"
            type="number" 
            min="0" 
            max="59"
            bind:value={secondsStr} 
          />
        </div>
      </div>
      
      <div class="mb-4">
        <label class="block text-sm mb-1 text-[var(--text-primary)]" for="message">Message</label>
        <Input 
          id="message"
          type="text" 
          placeholder="Timer message" 
          bind:value={newTimer.message}
        />
      </div>
      
      {#if errorMessage}
        <div class="text-[var(--accent-danger)] mb-4">{errorMessage}</div>
      {/if}
      
      <Button fullWidth on:click={handleCreateTimer}>
        Start Timer
      </Button>
      
      <div class="mt-2 text-xs text-[var(--text-secondary)]">
        Quick tip: You can also type "timer 5m Meeting starts" in the search bar!
      </div>
    </Card>
    
    <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
      <h2 class="text-xl font-semibold mb-4 text-[var(--text-primary)] flex-shrink-0">Active Timers</h2>
      
      <div 
        bind:this={timerListContainer} 
        class="flex-1 overflow-y-auto custom-scrollbar min-h-0 pr-1"
        style="max-height: calc(100% - 2rem);"
      >
        {#if activeTimers.length === 0}
          <div class="text-center py-8 text-[var(--text-secondary)] bg-[var(--bg-hover)] rounded-lg">
            No active timers
          </div>
        {:else}
          <div class="space-y-4 pb-8"> <!-- Increased padding-bottom from pb-4 to pb-8 -->
            {#each activeTimers as timer, i (timer.id)}
              <div class="flex items-center justify-between bg-[var(--bg-hover)] p-4 rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-selected)] {i === activeTimers.length - 1 ? 'mb-6' : ''}">
                <div>
                  <div class="font-medium text-[var(--text-primary)]">{timer.message}</div>
                  <div class="text-sm text-[var(--text-secondary)] flex items-center gap-2">
                    Ends in <span class="px-1.5 py-0.5 rounded-full text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--accent-primary)] font-mono">{getTimeLeft(timer)}</span>
                  </div>
                </div>
                <Button on:click={() => cancelTimer(timer.id)}>Cancel</Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .custom-scrollbar {
    scrollbar-width: thin;
  }
</style>
