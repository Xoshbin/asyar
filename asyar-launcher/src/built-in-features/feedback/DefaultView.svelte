<script lang="ts">
  import { Textarea } from '../../components';
  import { onMount } from 'svelte';
  import { TabGroup, Input, Button } from '../../components';
  import { feedbackViewState } from './feedbackState.svelte';
  import { feedbackSubmitService } from '../../services/feedback/feedbackSubmitService';
  import { authService } from '../../services/auth/authService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { t } from '../../services/i18n';

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
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'success',
        retryable: false,
        context: { message: 'Feedback sent — thank you!' },
      });
      feedbackViewState.reset();
    } catch (e) {
      feedbackService.report({
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
    <TabGroup variant="pills" tabs={categories} bind:activeTab={feedbackViewState.category} />

    <Textarea
      textIntent="natural"
      class="input feedback-message"
      placeholder={t('features.feedback.placeholder_tell_us')}
      rows="6"
      bind:value={feedbackViewState.message}
    ></Textarea>

    <Input
      textIntent="exact"
      placeholder={t('features.feedback.placeholder_email')}
      bind:value={feedbackViewState.email}
    />

    <div class="feedback-actions">
      <Button onclick={submit} disabled={!feedbackViewState.canSubmit}
        >{t('common.send_feedback')}</Button
      >
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

  :global(.feedback-message) {
    resize: vertical;
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
  }

  .feedback-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
