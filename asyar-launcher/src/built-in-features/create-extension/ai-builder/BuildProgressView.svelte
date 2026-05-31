<script lang="ts">
  import { buildJobStore } from './buildJobStore.svelte';
  import { startBuild } from './orchestrator';
  import { submitAnswer } from './questionBridge';
  import { aiBuildUiState } from './aiBuildUiState.svelte';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { Button, FormField, Input, ActionFooter, KeyboardHint, WarningBanner } from '../../../components';
  import { actionService } from '../../../services/action/actionService.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { sidecarClient } from './sidecarClient';
  import { openInEditor } from './openInEditor';
  import { publishExtension } from './publishExtension';

  // ── local reactive state ──────────────────────────────────────────────────
  let prompt = $state('');
  let answer = $state('');
  let startError = $state<string | null>(null);
  let isStarting = $state(false);

  // ── store binding ─────────────────────────────────────────────────────────
  const job = $derived(buildJobStore.job);

  // ── deep-link handshake ───────────────────────────────────────────────────
  $effect(() => {
    if (aiBuildUiState.openTrigger !== null) {
      aiBuildUiState.openTrigger = null;
    }
  });

  // ── state-appropriate action-panel actions ────────────────────────────────
  $effect(() => {
    const status = job?.status ?? null;

    if (status === 'working') {
      actionService.registerAction({
        id: 'ai-builder:cancel',
        label: 'Cancel Build',
        icon: 'icon:scissors',
        description: 'Stop the current build',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          await sidecarClient.cancel();
        },
      });
      return () => {
        actionService.unregisterAction('ai-builder:cancel');
      };
    }

    if (status === 'done' && job?.result) {
      const resultPath = job.result.path;
      actionService.registerAction({
        id: 'ai-builder:open-editor',
        label: 'Open in Editor',
        icon: 'icon:terminal',
        description: 'Open the built extension folder in your code editor',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          await openInEditor(resultPath);
        },
      });
      actionService.registerAction({
        id: 'ai-builder:build-another',
        label: 'Build Another',
        icon: 'icon:sparkles',
        description: 'Start a new AI-assisted extension build',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          buildJobStore.reset();
        },
      });
      actionService.registerAction({
        id: 'ai-builder:publish',
        label: 'Publish to Asyar Store',
        icon: 'icon:cloud-upload',
        description: 'Publish this extension to the Asyar Store via asyar publish',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          await publishExtension(resultPath);
        },
      });
      return () => {
        actionService.unregisterAction('ai-builder:open-editor');
        actionService.unregisterAction('ai-builder:build-another');
        actionService.unregisterAction('ai-builder:publish');
      };
    }

    if (status === 'failed' && job?.failure) {
      const failedPrompt = job.prompt;
      actionService.registerAction({
        id: 'ai-builder:retry',
        label: 'Refine & Retry',
        icon: 'icon:refresh',
        description: 'Retry the build with the same prompt',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const anthropicKey =
            settingsService.currentSettings.ai.providers['anthropic']?.apiKey ?? '';
          buildJobStore.reset();
          await startBuild(failedPrompt, { anthropicKey });
        },
      });
      actionService.registerAction({
        id: 'ai-builder:start-over',
        label: 'Start Over',
        icon: 'icon:trash',
        description: 'Clear the failed build and start fresh',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          buildJobStore.reset();
        },
      });
      return () => {
        actionService.unregisterAction('ai-builder:retry');
        actionService.unregisterAction('ai-builder:start-over');
      };
    }

    // idle / waiting — no panel actions; primary affordances are in-view
    return () => {};
  });

  // ── focus/blur signals for the launcher input gate ────────────────────────
  function handleFocus() {
    window.parent?.postMessage(
      { type: 'asyar:extension:input-focus', focused: true },
      window.location.origin
    );
  }

  function handleBlur() {
    window.parent?.postMessage(
      { type: 'asyar:extension:input-focus', focused: false },
      window.location.origin
    );
  }

  // ── idle state: start a build ─────────────────────────────────────────────
  async function onStart() {
    const trimmed = prompt.trim();
    if (!trimmed || isStarting) return;
    startError = null;
    isStarting = true;
    try {
      const anthropicKey =
        settingsService.currentSettings.ai.providers['anthropic']?.apiKey ?? '';
      const result = await startBuild(trimmed, { anthropicKey });
      if (!result.ok) {
        startError = result.reason ?? 'Build could not start.';
      }
    } finally {
      isStarting = false;
    }
  }

  function handlePromptKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void onStart();
    }
  }

  // ── waiting state: send an answer ─────────────────────────────────────────
  async function onAnswer() {
    const trimmed = answer.trim();
    if (!trimmed) return;
    await submitAnswer(trimmed);
    answer = '';
  }

  function handleAnswerKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void onAnswer();
    }
  }

  // ── waiting state: answer a confirm question ──────────────────────────────
  async function onConfirm(value: 'yes' | 'no') {
    await submitAnswer(value);
    answer = '';
  }
</script>

<div class="view-container">
  <div class="form-body custom-scrollbar">

    <!-- ── IDLE (no job) ──────────────────────────────────────────────── -->
    {#if !job}
      <div class="header">
        <h1 class="text-page-title">Build with AI</h1>
        <p class="text-subtitle">
          Describe what you want — the AI will scaffold, write, and verify your extension.
        </p>
      </div>

      <WarningBanner>
        The AI builds and runs generated code on your machine (like building any project). Only build extensions you understand.
      </WarningBanner>

      <p class="text-caption">
        For best results, use Anthropic Opus or a newer model — it produces the most reliable Asyar extensions.
      </p>

      <div class="fields">
        <FormField
          label="What should this extension do?"
          hint="e.g. Create an extension for Notion that lets me search my pages"
        >
          <textarea
            bind:value={prompt}
            placeholder="Create an extension for…"
            rows={4}
            autocapitalize="none"
            autocomplete="off"
            spellcheck={false}
            onfocus={handleFocus}
            onblur={handleBlur}
            onkeydown={handlePromptKeydown}
            class="field-textarea"
          ></textarea>
        </FormField>

        {#if startError}
          <div class="inline-error">{startError}</div>
        {/if}
      </div>

    <!-- ── WORKING ────────────────────────────────────────────────────── -->
    {:else if job.status === 'working'}
      <div class="header">
        <h1 class="text-page-title">Building…</h1>
        <p class="text-subtitle">
          You can leave this view — Asyar will notify you when input is needed or the build is done.
        </p>
      </div>

      {#if job.steps.length > 0}
        <ol class="step-list" aria-label="Build progress">
          {#each job.steps as step, i}
            <li class="step-item" class:step-latest={i === job.steps.length - 1}>
              <span class="step-label">{step.label}</span>
              {#if step.detail}
                <span class="step-detail">{step.detail}</span>
              {/if}
            </li>
          {/each}
        </ol>
      {:else}
        <p class="text-caption">Starting up…</p>
      {/if}

    <!-- ── WAITING (question) ─────────────────────────────────────────── -->
    {:else if job.status === 'waiting' && job.pendingQuestion}
      <div class="header">
        <h1 class="text-page-title">Input needed</h1>
      </div>

      {#if job.pendingQuestion.inputKind === 'confirm'}
        <p class="confirm-prompt">{job.pendingQuestion.prompt}</p>
      {:else}
        <div class="fields">
          <FormField label={job.pendingQuestion.prompt}>
            {#if job.pendingQuestion.inputKind === 'secret'}
              <Input
                type="password"
                bind:value={answer}
                placeholder={job.pendingQuestion.placeholder ?? ''}
                autocomplete="off"
                onfocus={handleFocus}
                onblur={handleBlur}
                onkeydown={handleAnswerKeydown}
              />
            {:else}
              <Input
                bind:value={answer}
                placeholder={job.pendingQuestion.placeholder ?? ''}
                autocapitalize="none"
                autocomplete="off"
                spellcheck={false}
                onfocus={handleFocus}
                onblur={handleBlur}
                onkeydown={handleAnswerKeydown}
              />
            {/if}
          </FormField>
        </div>
      {/if}

    <!-- ── DONE ───────────────────────────────────────────────────────── -->
    {:else if job.status === 'done' && job.result}
      <div class="header">
        <h1 class="text-page-title">✅ Ready</h1>
        <p class="text-subtitle">Your extension has been built and verified.</p>
      </div>

      <div class="result-card">
        <div class="result-row">
          <span class="result-label">Extension ID</span>
          <code class="result-value text-mono">{job.result.extensionId}</code>
        </div>
        <div class="result-divider"></div>
        <div class="result-row">
          <span class="result-label">Smoke test</span>
          <span class="result-value">{job.result.smokeSummary}</span>
        </div>
      </div>

      <p class="text-caption">
        Press <KeyboardHint keys="⌘K" /> to open the action panel — you can open in editor, load the extension, or start a new build from there.
      </p>

    <!-- ── FAILED ─────────────────────────────────────────────────────── -->
    {:else if job.status === 'failed' && job.failure}
      <div class="header">
        <h1 class="text-page-title">❌ Build failed</h1>
        <p class="text-subtitle">
          <span class="text-mono">{job.failure.step}</span>: {job.failure.error}
        </p>
      </div>

      {#if job.failure.log}
        <div class="log-section">
          <span class="section-header">Build log</span>
          <pre class="build-log custom-scrollbar">{job.failure.log}</pre>
        </div>
      {/if}

      <p class="text-caption">
        Open the action panel (<KeyboardHint keys="⌘K" />) to refine your prompt, retry, or start over.
      </p>
    {/if}

  </div>

  <!-- footer: primary affordance per state. Build/Cancel/retry/etc. for the
       non-input states live in the action panel; only the in-view input states
       (idle prompt, waiting answer/confirm) get a primary button here. -->
  <ActionFooter>
    {#snippet left()}
      {#if !job}
        {#if isStarting}<span class="text-caption animate-pulse">Starting…</span>{/if}
      {:else if job.status === 'working'}
        <span class="text-caption">{job.steps.length} step{job.steps.length === 1 ? '' : 's'} completed</span>
      {:else if job.status === 'waiting' && job.pendingQuestion}
        {#if job.pendingQuestion.inputKind === 'confirm'}
          <span class="text-caption">Choose an answer</span>
        {:else}
          <span class="text-caption">Press Enter to send</span>
        {/if}
      {:else if job.status === 'done' && job.result}
        <span class="text-caption">Build complete</span>
      {:else if job.status === 'failed' && job.failure}
        <span class="text-caption">See action panel to retry</span>
      {/if}
    {/snippet}

    {#snippet right()}
      {#if !job}
        <Button
          class="btn-primary"
          disabled={!prompt.trim() || isStarting}
          onclick={() => void onStart()}
        >
          {isStarting ? 'Starting…' : 'Build'}
        </Button>
      {:else if job.status === 'waiting' && job.pendingQuestion}
        {#if job.pendingQuestion.inputKind === 'confirm'}
          <div class="confirm-actions">
            <Button onclick={() => void onConfirm('no')}>No</Button>
            <Button class="btn-primary" onclick={() => void onConfirm('yes')}>Yes</Button>
          </div>
        {:else}
          <Button
            class="btn-primary"
            disabled={!answer.trim()}
            onclick={() => void onAnswer()}
          >
            Send answer
          </Button>
        {/if}
      {/if}
    {/snippet}
  </ActionFooter>
</div>

<style>
  /* ── scrollable body ───────────────────────────────────────────────────── */
  .form-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-7) var(--space-7) var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* ── header block ──────────────────────────────────────────────────────── */
  .header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* ── form fields container ─────────────────────────────────────────────── */
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  /* ── prompt textarea ───────────────────────────────────────────────────── */
  .field-textarea {
    resize: vertical;
    min-height: 96px;
  }

  /* ── confirm question prompt ───────────────────────────────────────────── */
  .confirm-prompt {
    font-size: var(--font-size-md);
    color: var(--text-primary);
    line-height: 1.5;
    margin: 0;
  }

  /* ── confirm Yes / No actions in footer ────────────────────────────────── */
  .confirm-actions {
    display: flex;
    gap: var(--space-3);
  }

  /* ── inline error (idle state) ─────────────────────────────────────────── */
  .inline-error {
    font-size: var(--font-size-sm);
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
    border-radius: var(--radius-sm);
    padding: var(--space-3) var(--space-4);
  }

  /* ── working state: step list ──────────────────────────────────────────── */
  .step-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .step-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    border-left: 2px solid var(--separator);
    opacity: 0.7;
    transition: opacity var(--transition-fast);
  }

  .step-item.step-latest {
    opacity: 1;
    border-left-color: var(--accent-primary);
    background: var(--bg-selected);
  }

  .step-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .step-detail {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  /* ── done state: result card ───────────────────────────────────────────── */
  .result-card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    overflow: hidden;
  }

  .result-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
  }

  .result-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-weight: 500;
    flex-shrink: 0;
  }

  .result-value {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    text-align: right;
    overflow-wrap: anywhere;
  }

  .result-divider {
    height: 1px;
    background: var(--separator);
  }

  /* ── failed state: build log ───────────────────────────────────────────── */
  .log-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .build-log {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    line-height: 1.6;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: var(--space-4) var(--space-5);
    margin: 0;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

</style>
