import type { OnboardingStepKind } from '../../lib/ipc/commands';

/** Glyph shown in each step's icon tile; `null` shows the app logo instead. */
export const STEP_GLYPHS: Record<OnboardingStepKind, string | null> = {
  welcome: null,
  aiSetup: 'sparkles',
  features: 'layers',
  personalize: 'palette',
  cheatSheet: 'keyboard',
};
