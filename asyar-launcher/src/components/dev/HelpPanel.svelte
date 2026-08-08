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
    <li>
      Press <kbd>Cmd</kbd>+<kbd>Option</kbd>+<kbd>I</kbd> on the launcher window to open DevTools.
    </li>
    <li>
      In the DevTools top bar, find the frame dropdown (chain icon next to the console filter).
    </li>
    <li>
      Select the worker iframe — labeled <code
        >asyar-extension://&lt;extension-id&gt;/worker.html</code
      >.
    </li>
    <li>The console and sources now reflect the worker context.</li>
  </ol>
  <p class="muted">
    For <em>view</em> iframes, select the <code>view.html</code> frame under the same dropdown.
  </p>
</div>

<style>
  .help-panel {
    padding: var(--space-5);
    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: var(--text-primary);
  }
  .help-panel h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .help-panel p {
    margin: 0 0 var(--space-3);
  }
  .help-panel ol {
    margin: 0 0 var(--space-3) var(--space-7);
    padding: 0;
  }
  .help-panel li {
    margin-bottom: var(--space-1);
  }
  .help-panel kbd {
    display: inline-block;
    padding: var(--space-0-5) var(--space-1-5);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    background: var(--bg-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }
  .help-panel code {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--accent-primary);
  }
  .muted {
    color: var(--text-secondary);
  }
</style>
