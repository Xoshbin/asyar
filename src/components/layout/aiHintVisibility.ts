/**
 * Pure derivation: determines whether the AI hint chip should be visible
 * in the bottom action bar.
 */
export interface AiHintVisibilityArgs {
  contextHint: { type: string } | null;
  activeContext: unknown;
  argumentModeActive: boolean;
  viewActive: boolean;
  diagnosticActive: boolean;
}

export function isAiHintVisible(args: AiHintVisibilityArgs): boolean {
  return (
    args.contextHint != null &&
    args.contextHint.type === 'ai' &&
    !args.activeContext &&
    !args.argumentModeActive &&
    !args.viewActive &&
    !args.diagnosticActive
  );
}
