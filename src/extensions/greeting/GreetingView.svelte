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
      <h2 class="text-2xl text-white mb-6">Greeting Form</h2>
      
      <div class="space-y-4">
        <input
          type="text"
          bind:value={name}
          placeholder="Enter your name"
          class="w-full p-2 bg-gray-800/30 text-white rounded border border-gray-700/20 focus:border-gray-600 outline-none transition-colors"
        />
        
        <button
          on:click={handleSubmit}
          class="w-full bg-gray-700/20 text-white p-2 rounded hover:bg-gray-700/40 transition-colors"
        >
          Greet Me
        </button>

        {#if greeting}
          <div class="mt-4 p-4 bg-gray-800/30 rounded text-white border border-gray-700/20">
            {greeting}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
