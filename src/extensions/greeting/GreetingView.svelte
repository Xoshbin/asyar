<script lang="ts">
  import { Input } from "../../components";
  import { Button } from "../../components";
  
  let name = '';
  let greeting = '';

  function handleSubmit() {
    greeting = `Hello, ${name}! Nice to meet you!`;
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

        {#if greeting}
          <div class="result-item p-4">
            <span class="result-title">{greeting}</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
