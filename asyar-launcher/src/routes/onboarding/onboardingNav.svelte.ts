import { advanceStep, goBackStep } from './stepLogic'

export interface OnbNav {
  showBack: boolean
  showSkip: boolean
  skipLabel: string
  primaryLabel: string
  primaryDisabled: boolean
  onBack: () => void | Promise<void>
  onSkip: () => void | Promise<void>
  onPrimary: () => void | Promise<void>
}

function defaults(): OnbNav {
  return {
    showBack: true,
    showSkip: false,
    skipLabel: 'Skip',
    primaryLabel: 'Continue',
    primaryDisabled: false,
    onBack: goBackStep,
    onSkip: advanceStep,
    onPrimary: advanceStep,
  }
}

class OnboardingNav {
  current = $state<OnbNav>(defaults())
  set(partial: Partial<OnbNav>) {
    this.current = { ...defaults(), ...partial }
  }
}

export const onboardingNav = new OnboardingNav()
