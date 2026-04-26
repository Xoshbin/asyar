<script lang="ts">
  // HelpPanel — replaces the deferred "Open Worker DevTools" button.
  // Tauri's webview.open_devtools() opens DevTools for the whole launcher
  // webview, not a specific iframe. The user picks the target frame from
  // DevTools' own frame dropdown.
</script>

<div class="help-panel">
  <h3>Worker DevTools</h3>
  <p>Tauri cannot open DevTools scoped to a single iframe.</p>
  <ol>
    <li>Press <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> on the launcher window to open DevTools.</li>
    <li>In the DevTools top bar, find the frame dropdown (chain icon next to the console filter).</li>
    <li>Select the worker iframe — labeled <code>asyar-extension://&lt;extension-id&gt;/worker.html</code>.</li>
    <li>The console and sources now reflect the worker context.</li>
  </ol>
  <p class="muted">
    For <em>view</em> iframes, select the <code>view.html</code> frame under the same dropdown.
  </p>
</div>

<style>
  .help-panel {
    padding: 12px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text, #ddd);
  }
  .help-panel h3 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted, #999);
  }
  .help-panel p {
    margin: 0 0 8px;
  }
  .help-panel ol {
    margin: 0 0 8px 20px;
    padding: 0;
  }
  .help-panel li {
    margin-bottom: 4px;
  }
  .help-panel kbd {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid var(--color-border, #444);
    border-radius: 3px;
    background: var(--color-surface-2, #222);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
  }
  .help-panel code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 11px;
    color: var(--color-text-accent, #8ab4f8);
  }
  .muted {
    color: var(--color-text-muted, #888);
  }
</style>
