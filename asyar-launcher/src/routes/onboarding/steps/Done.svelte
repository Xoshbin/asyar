<script lang="ts">
  import { Card, Button } from '../../../components'
  import { completeStep, goBackStep } from '../stepLogic'
</script>

<Card>
  <h1>You're set</h1>
  <p>Hit your hotkey to summon Asyar anytime. Have fun.</p>
  <div class="actions">
    <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
    <Button onclick={completeStep}>Open Asyar</Button>
  </div>
</Card>

<style>
  .actions { display: flex; justify-content: space-between; margin-top: var(--space-5); }
</style>
