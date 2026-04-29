import { onboardingCommands, type OnboardingState } from '../../lib/ipc/commands'
import { logService } from '../log/logService'
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte'

class OnboardingServiceClass {
  state = $state<OnboardingState | null>(null)
  loading = $state(false)

  async load(): Promise<void> {
    this.loading = true
    try {
      this.state = await onboardingCommands.getState()
    } catch (err) {
      logService.warn('[onboardingService] load failed', err)
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

  reset(): void {
    this.state = null
    this.loading = false
  }
}

export const onboardingService = new OnboardingServiceClass()
