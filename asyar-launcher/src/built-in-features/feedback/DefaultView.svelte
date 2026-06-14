<script lang="ts">
  import { onMount } from 'svelte';
  import { TabGroup, Input, Button } from '../../components';
  import { feedbackViewState } from './feedbackState.svelte';
  import { feedbackSubmitService } from '../../services/feedback/feedbackSubmitService';
  import { authService } from '../../services/auth/authService.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';

  const categories: { id: string; label: string }[] = [
    { id: 'idea', label: 'Idea' },
    { id: 'bug', label: 'Bug' },
    { id: 'other', label: 'Other' },
  ];

  onMount(() => {
    if (authService.user?.email) feedbackViewState.email = authService.user.email;
  });

  async function submit() {
    if (!feedbackViewState.canSubmit) return;
    feedbackViewState.submitting = true;
    try {
      await feedbackSubmitService.submit(feedbackViewState.toInput());
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'success',
        retryable: false,
        context: { message: 'Feedback sent — thank you!' },
      });
      feedbackViewState.reset();
    } catch (e) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: 'Failed to send feedback. Please try again.' },
        developerDetail: String(e),
      });
    } finally {
      feedbackViewState.submitting = false;
    }
  }
</script>

<div class="feedback-view">
  <div class="feedback-body custom-scrollbar">
    <TabGroup
      variant="pills"
      tabs={categories}
      bind:activeTab={feedbackViewState.category}
    />

    <textarea
      class="input feedback-message"
      placeholder="Tell us what's on your mind…"
      rows="6"
      bind:value={feedbackViewState.message}
    ></textarea>

    <Input placeholder="Email (optional — or clear to send anonymously)" bind:value={feedbackViewState.email} />

    <div class="feedback-actions">
      <Button onclick={submit} disabled={!feedbackViewState.canSubmit}>Send Feedback</Button>
    </div>
  </div>
</div>

<style>
  .feedback-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .feedback-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    overflow-y: auto;
    flex: 1;
  }

  .feedback-message {
    resize: vertical;
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
  }

  .feedback-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
