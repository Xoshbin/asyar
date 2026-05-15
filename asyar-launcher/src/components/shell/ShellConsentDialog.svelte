<script lang="ts">
  import { 
    ModalOverlay, 
    Button, 
    ExtensionAvatar, 
    WarningBanner 
  } from '../index';
  
  interface Props {
    extensionName: string;
    extensionIcon?: string;
    program: string;
    resolvedPath: string;
    onAllow: () => void;
    onDeny: () => void;
  }
  
  let { extensionName, extensionIcon, program, resolvedPath, onAllow, onDeny }: Props = $props();
  
  const safePaths = [
    '/usr/bin',
    '/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    'C:\\Windows\\System32',
    'C:\\Program Files',
  ];
  
  const isSafe = $derived(safePaths.some(safe => resolvedPath.startsWith(safe)));
  
  // Format program beautifully
  const baseName = $derived(resolvedPath.split(/[\\/]/).pop() || resolvedPath);
  const isAliasDiff = $derived(
    program !== resolvedPath && 
    program !== baseName && 
    program.toLowerCase() !== baseName.toLowerCase()
  );

  function handleDeny() {
    onDeny();
  }
  
  function handleAllow() {
    onAllow();
  }
</script>

<ModalOverlay width="420px">
  <div class="dialog-container">
    
    <!-- Component-Driven Horizontal Header -->
    <div class="dialog-header">
      <ExtensionAvatar 
        name={extensionName} 
        src={extensionIcon} 
        size="md" 
      />

      <div class="header-texts">
        <span class="app-name">{extensionName}</span>
        <span class="app-intent">wants to access the terminal</span>
      </div>
    </div>

    <!-- Terminal Simulator Box using design tokens -->
    <div class="terminal-box">
      <div class="terminal-header">
        <div class="window-controls">
          <div class="control close"></div>
          <div class="control minimize"></div>
          <div class="control maximize"></div>
        </div>
        <span class="terminal-title">zsh</span>
      </div>

      <div class="terminal-body">
        <div class="terminal-line">
          <span class="prompt">$</span>
          <span class="command">{baseName}</span>
        </div>
        <div class="terminal-details">
          <span class="path">{resolvedPath}</span>
          {#if isAliasDiff}
            <div class="alias-row">
              <span class="alias-label">Alias:</span>
              <span class="alias-value">{program}</span>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- System Warning Banner component -->
    {#if !isSafe}
      <WarningBanner>
        <div class="warning-content">
          <span class="warning-title">Non-standard:</span>
          This binary runs outside standard system paths.
        </div>
      </WarningBanner>
    {/if}

    <!-- Clean Explanation Row -->
    <p class="explanation-text">
      Allows the extension to run this command. Revoke in Settings anytime.
    </p>

    <!-- Actions using Button Component -->
    <div class="button-actions">
      <Button 
        class="btn-secondary"
        onclick={handleDeny}
        fullWidth={true}
      >
        Deny
      </Button>
      <Button 
        class="btn-primary"
        onclick={handleAllow}
        fullWidth={true}
      >
        Allow Always
      </Button>
    </div>

  </div>
</ModalOverlay>

<style>
  .dialog-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    text-align: left;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-0-5);
    user-select: none;
  }

  .header-texts {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .app-name {
    font-family: var(--font-ui);
    font-size: var(--font-size-lg);
    font-weight: 600; /* font-semibold */
    color: var(--text-primary);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-intent {
    font-family: var(--font-ui);
    font-size: var(--font-size-xs);
    font-weight: 500; /* font-medium */
    color: var(--text-secondary);
    line-height: 1.2;
    margin-top: 2px;
  }

  .terminal-box {
    width: 100%;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--border-color);
    background-color: var(--bg-tertiary);
    box-shadow: var(--shadow-sm);
  }

  .terminal-header {
    height: 28px;
    padding: 0 var(--space-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background-color: var(--bg-hover);
    border-bottom: 1px solid var(--border-color);
    user-select: none;
  }

  .window-controls {
    display: flex;
    gap: 6px;
  }

  .control {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
  }
  
  .control.close { background-color: var(--accent-danger); opacity: 0.8; }
  .control.minimize { background-color: var(--accent-warning); opacity: 0.8; }
  .control.maximize { background-color: var(--accent-success); opacity: 0.8; }

  .terminal-title {
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .terminal-body {
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: var(--space-1-5);
  }

  .terminal-line {
    display: flex;
    align-items: flex-start;
    gap: var(--space-1-5);
  }

  .prompt {
    color: var(--accent-success);
    font-weight: 600;
    user-select: none;
  }

  .command {
    color: var(--accent-primary);
    font-weight: 600;
    word-break: break-all;
  }

  .terminal-details {
    padding-left: var(--space-4);
    border-left: 1px solid var(--separator);
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--font-size-2xs);
    color: var(--text-secondary);
  }

  .path {
    word-break: break-all;
  }

  .alias-row {
    display: flex;
    gap: var(--space-1);
    margin-top: 2px;
  }

  .alias-label {
    color: var(--text-tertiary);
    user-select: none;
  }

  .alias-value {
    color: var(--accent-primary);
  }

  .warning-content {
    font-family: var(--font-ui);
    font-size: var(--font-size-xs);
    line-height: 1.4;
    color: var(--text-primary);
  }

  .warning-title {
    font-weight: 600;
    color: var(--accent-warning);
    margin-right: var(--space-1);
    text-transform: uppercase;
    font-size: var(--font-size-2xs);
    letter-spacing: 0.05em;
  }

  .explanation-text {
    margin: 0;
    padding: 0 var(--space-0-5);
    font-family: var(--font-ui);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.4;
    user-select: none;
  }

  .button-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    width: 100%;
    margin-top: var(--space-1);
  }
</style>
