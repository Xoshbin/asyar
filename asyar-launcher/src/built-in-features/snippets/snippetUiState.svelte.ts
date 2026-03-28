class SnippetUiState {
  editorTrigger = $state<'add' | null>(null);
}
export const snippetUiState = new SnippetUiState();
