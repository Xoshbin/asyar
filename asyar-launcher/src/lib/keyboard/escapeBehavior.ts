/** The two Escape behaviors Asyar offers, matching Raycast 1:1. */
export type EscapeBehavior = 'go-back' | 'hide-and-reset';

/**
 * Normalizes a stored `general.escapeInViewBehavior` value to a supported
 * behavior.
 *
 * The legacy `close-window` option ("Hide Window") folds into `go-back`:
 * `go-back`'s terminal step at root is already a reset-free hide, so the only
 * property that distinguished `close-window` survives — it just pops open views
 * first. `popToRootDelay` now owns whether a hide resets the view.
 *
 * Unknown and missing values default to `go-back`, which is also the shipped
 * default.
 */
export function resolveEscapeBehavior(raw: string | undefined): EscapeBehavior {
  return raw === 'hide-and-reset' ? 'hide-and-reset' : 'go-back';
}
