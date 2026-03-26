<script lang="ts">
  let {
    title = "Asyar",
    showBackButton = false,
    onback
  }: {
    title?: string;
    showBackButton?: boolean;
    onback?: () => void;
  } = $props();
</script>

<header class="bg-gray-800 text-white p-4 flex items-center">
  {#if showBackButton}
    <button
      onclick={() => onback?.()}
      class="mr-4 text-gray-300 hover:text-white focus:outline-none"
      aria-label="Back"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  {/if}

  <h1 class="text-xl font-medium">{title}</h1>
</header>
