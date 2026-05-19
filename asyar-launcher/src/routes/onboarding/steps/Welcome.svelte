<script lang="ts">
  import { Card, Button } from '../../../components'
  import { advanceStep } from '../stepLogic'
</script>

<Card>
  <h1>Welcome to Asyar <span class="beta">Beta</span></h1>
  <p>A keyboard-first launcher for everything on your Mac, Linux, or Windows machine.</p>
  <p>Asyar is still in beta — rough edges are possible, and your feedback shapes what comes next. Thanks for being an early user.</p>
  <p class="hint">In a moment we'll set up your hotkey and let you pick a few extensions to try.</p>
  <div class="actions">
    <Button onclick={advanceStep}>Get started</Button>
  </div>
</Card>

<style>
  h1 { font-size: var(--font-size-xl); margin: 0 0 var(--space-2); display: flex; align-items: center; gap: var(--space-2); }
  .beta {
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent-subtle, rgba(120, 120, 255, 0.15));
    color: var(--accent, var(--text-primary));
  }
  .hint { color: var(--text-secondary); }
  .actions { display: flex; justify-content: flex-end; margin-top: var(--space-5); }
</style>
