<script lang="ts">
  import { logService } from '../../../services/log/logService';
  let { value = "" } = $props();
  
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

<div class="result-display flex items-center justify-between p-4 bg-[var(--bg-tertiary)] rounded-lg mt-4">
  <span class="text-2xl text-[var(--text-primary)] break-all" style="font-family: var(--font-mono);">{value || "---"}</span>
  <button
    class="px-4 py-2 bg-[var(--accent-primary)] hover:opacity-90 active:opacity-80 text-white rounded shadow-sm transition-colors text-sm font-medium flex-shrink-0 ml-4 disabled:opacity-50"
    onclick={copyValue}
    disabled={!value}
  >
    Copy
  </button>
</div>
