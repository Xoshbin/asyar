<script lang="ts">
  import extensionManager from '../../services/extensionManager';
  
  let name = '';
  let greeting = '';

  function handleSubmit() {
    greeting = `Hello, ${name}! Nice to meet you!`;
  }
</script>

<div class="overflow-y-auto">
  <div class="p-8">
    <div class="max-w-md mx-auto">
      <h2 class="text-2xl text-white mb-6">Greeting Form</h2>
      
      <div class="space-y-4">
        <input
          type="text"
          bind:value={name}
          placeholder="Enter your name"
          class="w-full p-2 bg-gray-700 text-white rounded"
        />
        
        <button
          on:click={handleSubmit}
          class="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
        >
          Greet Me
        </button>

        {#if greeting}
          <div class="mt-4 p-4 bg-gray-700 rounded text-white">
            {greeting}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
