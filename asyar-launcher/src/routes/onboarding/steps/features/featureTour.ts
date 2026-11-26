export type TourSlideId = 'clipboard' | 'snippets' | 'emoji' | 'ai' | 'files' | 'window';

export const TOUR_SLIDES: readonly TourSlideId[] = [
  'clipboard',
  'snippets',
  'emoji',
  'ai',
  'files',
  'window',
];

/** Fixed id of the seeded Grammar Fix agent (Rust `GRAMMAR_FIX_AGENT_ID`). */
export const GRAMMAR_FIX_AGENT_ID = 'grammar-fix';
export const GRAMMAR_FIX_OBJECT_ID = `cmd_agents_dyn_${GRAMMAR_FIX_AGENT_ID}`;
