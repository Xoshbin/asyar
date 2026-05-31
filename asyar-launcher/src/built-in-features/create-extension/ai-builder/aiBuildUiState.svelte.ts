// Deep-link handshake (mirrors snippets' editorTrigger): the command sets this,
// the view reads it on mount/effect to focus the active job's pending question.
class AiBuildUiState {
  openTrigger = $state<string | null>(null); // buildId or 'current'
}
export const aiBuildUiState = new AiBuildUiState();
