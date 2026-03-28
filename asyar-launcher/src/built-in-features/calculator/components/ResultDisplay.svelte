<script lang="ts">
  import { logService } from '../../../services/log/logService';
  export let value: string = "";
  
  async function copyValue() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      // Let the caller handle notifications OR just assume it copied
    } catch (e) {
      logService.error(String(e));
    }
  }
</script>

<div class="result-display flex items-center justify-between p-4 bg-gray-100 dark:bg-gray-800 rounded-lg mt-4">
  <span class="text-2xl font-mono text-gray-900 dark:text-gray-100 break-all">{value || "---"}</span>
  <button 
    class="px-4 py-2 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded shadow-sm transition-colors text-sm font-medium flex-shrink-0 ml-4 disabled:opacity-50"
    on:click={copyValue}
    disabled={!value}
  >
    Copy
  </button>
</div>
