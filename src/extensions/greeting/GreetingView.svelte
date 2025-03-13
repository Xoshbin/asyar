<script lang="ts">
  import { Input, Button } from "asyar-extension-sdk";
  
  let name = '';
  let greeting = 'Welcome to Greeting Extension!';
  let userGreeting = '';

  function handleSubmit() {
    userGreeting = `Hello, ${name}! Nice to meet you!`;
  }
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
        
        <Button fullWidth on:click={handleSubmit}>
          Greet Me
        </Button>

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
</div>

<style>
  .greeting-container {
    padding: 1rem;
    text-align: center;
  }
</style>
