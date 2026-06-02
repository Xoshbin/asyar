import type { OnboardingStepKind } from '../../lib/ipc/commands'

export interface StepVisual {
  image: string
  lean: 'left' | 'right'
}

export const STEP_VISUALS: Record<OnboardingStepKind, StepVisual> = {
  welcome:            { image: '/onboarding/getting-started-hero.png',           lean: 'right' },
  summonSearch:       { image: '/onboarding/the-basics-results.png',             lean: 'right' },
  clipboard:          { image: '/onboarding/feature-clipboard-hero.png',         lean: 'left'  },
  portals:            { image: '/onboarding/feature-portals-hero.png',           lean: 'right' },
  aiSetup:            { image: '/onboarding/feature-ai-agents-hero.png',         lean: 'right' },
  hiddenCommands:     { image: '/onboarding/keyboard-shortcuts-help.png',        lean: 'left'  },
  emoji:              { image: '/onboarding/feature-aliases-shortcuts-hero.png', lean: 'right' },
  snippets:           { image: '/onboarding/feature-snippets-hero.png',          lean: 'left'  },
  featuredExtensions: { image: '/onboarding/feature-extensions-hero.png',        lean: 'right' },
  pickTheme:          { image: '/onboarding/settings-general.png',               lean: 'left'  },
  cheatSheet:         { image: '/onboarding/keyboard-shortcuts-help.png',        lean: 'right' },
}
