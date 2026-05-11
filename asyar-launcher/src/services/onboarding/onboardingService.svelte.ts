import { onboardingCommands, completeAiOnboarding, isAiOnboardingCompleted, type OnboardingState } from '../../lib/ipc/commands'
import { logService } from '../log/logService'
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte'

class OnboardingServiceClass {
  state = $state<OnboardingState | null>(null)
  loading = $state(false)
  aiCompleted = $state<boolean>(false)

  async load(): Promise<void> {
    this.loading = true
    try {
      this.state = await onboardingCommands.getState()
    } catch (err) {
      logService.warn(`[onboardingService] load failed: ${err}`)
      diagnosticsService.report({
        source: 'frontend',
        kind: 'onboarding-load-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      })
    } finally {
      this.loading = false
    }
  }

  async advance(): Promise<void> {
    try {
      this.state = await onboardingCommands.advance()
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'onboarding-advance-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      })
    }
  }

  async goBack(): Promise<void> {
    try {
      this.state = await onboardingCommands.goBack()
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'onboarding-go-back-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      })
    }
  }

  async complete(): Promise<void> {
    try {
      await onboardingCommands.complete()
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'onboarding-complete-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      })
    }
  }

  async dismiss(): Promise<void> {
    try {
      await onboardingCommands.dismiss()
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'onboarding-dismiss-failed',
        severity: 'error',
        retryable: false,
        developerDetail: String(err),
      })
    }
  }

  async loadAi(): Promise<void> {
    try {
      this.aiCompleted = await isAiOnboardingCompleted()
    } catch (err) {
      logService.warn(`Failed to load AI onboarding state: ${err}`)
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: true,
        context: { message: 'Could not check AI setup status.' },
      })
    }
  }

  async skipAiSetup(): Promise<void> {
    try {
      if (this.state?.current === 'aiSetup') {
        await this.advance();
      }
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: 'Could not skip AI setup. Please try again.' },
      });
    }
  }

  async completeAi(): Promise<void> {
    try {
      await completeAiOnboarding()
      this.aiCompleted = true
    } catch (err) {
      logService.warn(`Failed to mark AI onboarding complete: ${err}`)
      diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: true,
        context: { message: 'Could not save AI setup. Please try again.' },
      })
      throw err
    }
  }

  reset(): void {
    this.state = null
    this.loading = false
    this.aiCompleted = false
  }
}

export const onboardingService = new OnboardingServiceClass()
