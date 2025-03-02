<script lang="ts">
  import { onMount } from 'svelte';
  import { appInitializer } from '../lib/appInitializer';
  import { LogService } from '../services/logService';

  onMount(async () => {
    // Initialize app in the correct sequence
    await appInitializer.initializeApp();
    
    // Apply theme
    const htmlElement = document.documentElement;
  });
</script>

<slot />
