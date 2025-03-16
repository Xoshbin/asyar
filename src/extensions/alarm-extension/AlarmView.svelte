<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { alarmState, type Timer } from './state';
  import { format } from 'date-fns';
  import { SplitView, Button } from 'asyar-extension-sdk';

  let timers: Timer[] = [];
  let intervalId: number;
  let newTimerMinutes = 5;
  let newTimerMessage = "";
  let timerFormVisible = false;

  // Subscribe to alarmState
  const unsubscribe = alarmState.subscribe(state => {
    timers = state.timers;
  });

  // Setup interval to update remaining time
  onMount(() => {
    intervalId = setInterval(() => {
      // Force a UI update by creating a new array
      timers = [...timers];
    }, 1000);
  });

  onDestroy(() => {
    unsubscribe();
    clearInterval(intervalId);
  });

  // Calculate remaining time for a timer
  function getRemainingTime(timer: Timer): string {
    if (!timer.active) return 'Completed';
    
    const remainingMs = Math.max(0, timer.endsAt - Date.now());
    const totalSeconds = Math.floor(remainingMs / 1000);
    
    if (totalSeconds <= 0) return 'Completed';
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  function getProgressPercent(timer: Timer): number {
    if (!timer.active) return 100;
    
    const totalDuration = timer.duration * 1000;
    const elapsed = Date.now() - timer.createdAt;
    const percent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
    
    return percent;
  }

  function toggleTimerForm() {
    timerFormVisible = !timerFormVisible;
    if (timerFormVisible) {
      newTimerMinutes = 5;
      newTimerMessage = "";
    }
  }

  async function createNewTimer() {
    if (newTimerMinutes <= 0) return;
    
    try {
      const seconds = newTimerMinutes * 60;
      const message = newTimerMessage || `${newTimerMinutes} minute timer`;
      
      await alarmState.createTimer(seconds, message);
      toggleTimerForm();
    } catch (error) {
      console.error('Failed to create timer:', error);
    }
  }

  function deleteTimer(timer: Timer) {
    alarmState.deleteTimer(timer.id);
  }

  // Get classes for timer based on remaining time
  function getTimerClasses(timer: Timer): string {
    if (!timer.active) return 'opacity-60';
    
    const remainingMs = timer.endsAt - Date.now();
    if (remainingMs <= 10000) return 'timer-alert';
    if (remainingMs <= 60000) return 'timer-warning';
    
    return '';
  }
</script>

<div class="alarm-extension-container">
  <div class="toolbar">
    <h2 class="title">Timers</h2>
    <Button on:click={toggleTimerForm}>
      {timerFormVisible ? 'Cancel' : 'New Timer'}
    </Button>
  </div>
  
  {#if timerFormVisible}
    <div class="timer-form">
      <div class="form-row">
        <label for="newTimerMinutes">Minutes:</label>
        <input 
          type="number" 
          id="newTimerMinutes"
          bind:value={newTimerMinutes}
          min="1"
          class="input"
        />
      </div>
      <div class="form-row">
        <label for="newTimerMessage">Message:</label>
        <input 
          type="text" 
          id="newTimerMessage"
          bind:value={newTimerMessage}
          placeholder="Timer message"
          class="input"
        />
      </div>
      <div class="form-actions">
        <Button on:click={createNewTimer}>Set Timer</Button>
      </div>
    </div>
  {/if}
  
  <div class="timers-list">
    {#if timers.length === 0}
      <div class="empty-state">
        <p>No active timers</p>
        <Button on:click={toggleTimerForm}>Create a Timer</Button>
      </div>
    {:else}
      {#each timers.filter(t => t.active) as timer (timer.id)}
        <div class="timer-item {getTimerClasses(timer)}">
          <div class="timer-content">
            <h3>{timer.message}</h3>
            <div class="timer-details">
              <span class="timer-time">{getRemainingTime(timer)}</span>
              <span class="timer-end">
                Ends: {format(timer.endsAt, 'HH:mm:ss')}
              </span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: {getProgressPercent(timer)}%"></div>
            </div>
          </div>
          <button class="delete-button" on:click={() => deleteTimer(timer)}>
            ×
          </button>
        </div>
      {/each}
      
      {#if timers.some(t => !t.active)}
        <div class="completed-section">
          <h3>Completed</h3>
          {#each timers.filter(t => !t.active) as timer (timer.id)}
            <div class="timer-item completed">
              <div class="timer-content">
                <h3>{timer.message}</h3>
                <div class="timer-details">
                  <span class="timer-time">Completed</span>
                  <span class="timer-end">
                    At: {format(timer.endsAt, 'HH:mm:ss')}
                  </span>
                </div>
              </div>
              <button class="delete-button" on:click={() => deleteTimer(timer)}>
                ×
              </button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .alarm-extension-container {
    padding: 1rem;
    max-width: 600px;
    margin: 0 auto;
  }
  
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  
  .title {
    margin: 0;
    font-size: 1.5rem;
  }
  
  .timer-form {
    background-color: var(--bg-selected);
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1.5rem;
  }
  
  .form-row {
    margin-bottom: 0.75rem;
    display: flex;
    flex-direction: column;
  }
  
  .form-row label {
    margin-bottom: 0.25rem;
  }
  
  .input {
    padding: 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid var(--border-color);
    background-color: var(--bg-primary);
    color: var(--fg-primary);
  }
  
  .form-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  
  .timers-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .timer-item {
    background-color: var(--bg-selected);
    padding: 1rem;
    border-radius: 0.5rem;
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.3s ease;
  }
  
  .timer-content {
    flex: 1;
  }
  
  .timer-item h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1rem;
    word-break: break-word;
  }
  
  .timer-details {
    display: flex;
    justify-content: space-between;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }
  
  .timer-time {
    font-weight: bold;
  }
  
  .timer-end {
    color: var(--fg-secondary);
  }
  
  .progress-bar {
    height: 4px;
    background-color: var(--border-color);
    border-radius: 2px;
    overflow: hidden;
  }
  
  .progress-fill {
    height: 100%;
    background-color: var(--accent-color);
    transition: width 1s linear;
  }
  
  .delete-button {
    background: none;
    border: none;
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: 50%;
    color: var(--fg-primary);
    opacity: 0.6;
    transition: opacity 0.2s ease;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .delete-button:hover {
    opacity: 1;
    background-color: rgba(255, 0, 0, 0.1);
  }
  
  .completed-section {
    margin-top: 1.5rem;
    opacity: 0.7;
  }
  
  .completed-section h3 {
    font-size: 1rem;
    margin-bottom: 0.5rem;
    color: var(--fg-secondary);
  }
  
  .timer-alert {
    animation: pulse 1s infinite;
    background-color: rgba(255, 0, 0, 0.1);
    border: 1px solid rgba(255, 0, 0, 0.3);
  }
  
  .timer-warning {
    background-color: rgba(255, 165, 0, 0.1);
    border: 1px solid rgba(255, 165, 0, 0.3);
  }
  
  .empty-state {
    text-align: center;
    padding: 2rem 0;
    color: var(--fg-secondary);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.7; }
    100% { opacity: 1; }
  }
</style>
