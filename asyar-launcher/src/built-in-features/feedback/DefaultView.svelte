<script lang="ts">
  import { Textarea, TabGroup, Input, FormView } from '../../components';
  import { onMount } from 'svelte';
  import { feedbackViewState } from './feedbackState.svelte';
  import { feedbackSubmitService } from '../../services/feedback/feedbackSubmitService';
  import { authService } from '../../services/auth/authService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { t } from '../../services/i18n';

  let categories = $derived<{ id: string; label: string }[]>([
    { id: 'idea', label: t('features.feedback.category_idea') },
    { id: 'bug', label: t('features.feedback.category_bug') },
    { id: 'other', label: t('features.feedback.category_other') },
  ]);

  onMount(() => {
    if (authService.user?.email) feedbackViewState.email = authService.user.email;
  });

  async function submit() {
    if (!feedbackViewState.canSubmit || feedbackViewState.submitting) return;
    feedbackViewState.submitting = true;
    try {
      await feedbackSubmitService.submit(feedbackViewState.toInput());
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'success',
        retryable: false,
        context: { message: t('features.feedback.success_sent') },
      });
      if (viewManager.activeView === 'feedback/DefaultView') {
        feedbackViewState.reset();
        extensionManager.goBack();
      }
    } catch (e) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.feedback.error_failed') },
        developerDetail: String(e),
      });
    } finally {
      feedbackViewState.submitting = false;
    }
  }
</script>

<FormView
  actionId="feedback:submit"
  submitLabel={t('common.send_feedback')}
  extensionId="feedback"
  submitDisabled={!feedbackViewState.canSubmit || feedbackViewState.submitting}
  onsubmit={submit}
>
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
</FormView>

<style>
  :global(.feedback-message) {
    resize: vertical;
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
  }
</style>
