class SnippetUiState {
  editorTrigger = $state<'add' | null>(null);
  prefillExpansion = $state<string | null>(null);
}
export const snippetUiState = new SnippetUiState();
