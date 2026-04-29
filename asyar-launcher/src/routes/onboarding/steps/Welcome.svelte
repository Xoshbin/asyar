<script lang="ts">
  import { Card, Button } from '../../../components'
  import { advanceStep } from '../stepLogic'
</script>

<Card>
  <h1>Welcome to Asyar</h1>
  <p>A keyboard-first launcher for everything on your Mac, Linux, or Windows machine.</p>
  <p class="hint">In a moment we'll set up your hotkey and let you pick a few extensions to try.</p>
  <div class="actions">
    <Button onclick={advanceStep}>Get started</Button>
  </div>
</Card>

<style>
  h1 { font-size: var(--font-size-xl); margin: 0 0 var(--space-2); }
  .hint { color: var(--text-secondary); }
  .actions { display: flex; justify-content: flex-end; margin-top: var(--space-5); }
</style>
