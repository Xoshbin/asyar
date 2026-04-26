<script lang="ts">
  type State = 'dormant' | 'mounting' | 'ready' | 'degraded' | 'unknown';

  let { state }: { state: State } = $props();
</script>

<span class="badge state-{state}" title={state}>
  {state}
</span>

<style>
  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 14px;
  }
  .state-dormant {
    background: rgba(140, 140, 140, 0.22);
    color: #b0b0b0;
  }
  .state-mounting {
    background: rgba(255, 190, 90, 0.18);
    color: #ffbe5a;
  }
  .state-ready {
    background: rgba(90, 220, 110, 0.18);
    color: #5adc6e;
  }
  .state-degraded {
    background: rgba(240, 100, 100, 0.22);
    color: #f06464;
  }
  .state-unknown {
    background: rgba(140, 140, 140, 0.12);
    color: #808080;
  }
</style>
