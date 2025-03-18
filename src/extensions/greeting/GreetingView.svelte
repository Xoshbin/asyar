<script lang="ts">
  import { Input, Button } from "asyar-api";
  import { onMount, onDestroy } from 'svelte';
  
  let name = '';
  let greeting = 'Welcome to Greeting Extension!';
  let userGreeting = '';

  function handleSubmit() {
    userGreeting = `Hello, ${name}! Nice to meet you!`;
  }
  
  function resetForm() {
    name = '';
    userGreeting = '';
  }
  
  // Listen for reset form events from the action panel
  function handleResetEvent() {
    resetForm();
  }
  
  // Listen for set name events from commands
  function handleSetNameEvent(event: CustomEvent) {
    name = event.detail.name;
    handleSubmit(); // Auto-submit the form
  }
  
  onMount(() => {
    document.addEventListener('greeting-reset-form', handleResetEvent);
    document.addEventListener('greeting-set-name', handleSetNameEvent as EventListener);
  });
  
  onDestroy(() => {
    document.removeEventListener('greeting-reset-form', handleResetEvent);
    document.removeEventListener('greeting-set-name', handleSetNameEvent as EventListener);
  });
</script>

<div class="min-h-[calc(100vh-72px)]">
  <div class="p-8">
    <div class="max-w-md mx-auto">
      <h2 class="text-2xl result-title mb-6">Greeting Form</h2>
      
      <div class="space-y-4">
        <Input 
          bind:value={name}
          placeholder="Enter your name"
        />
        
        <div class="flex gap-3">
          <Button fullWidth on:click={handleSubmit}>
            Greet Me
          </Button>
          
          <Button on:click={resetForm}>
            Reset
          </Button>
        </div>

        {#if userGreeting}
          <div class="result-item p-4">
            <span class="result-title">{userGreeting}</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<div class="greeting-container">
  <h2>{greeting}</h2>
  <p class="text-sm text-gray-500 mt-2">Try the commands "greet" or "hey [name]" in the search box!</p>
</div>

<style>
  .greeting-container {
    padding: 1rem;
    text-align: center;
  }
</style>
