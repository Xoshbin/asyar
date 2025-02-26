<script lang="ts">
  import extensionManager from '../../services/extensionManager';
  
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
        <input
          type="text"
          bind:value={name}
          placeholder="Enter your name"
          class="result-item search-input w-full p-2"
        />
        
        <button
          on:click={handleSubmit}
          class="result-item w-full p-2"
        >
          <span class="result-title">Greet Me</span>
        </button>

        {#if greeting}
          <div class="result-item p-4">
            <span class="result-title">{greeting}</span>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
