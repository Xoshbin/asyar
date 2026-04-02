/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { snippetUiState } from './snippetUiState.svelte'

describe('snippetUiState', () => {
  it('prefillExpansion starts as null', () => {
    expect(snippetUiState.prefillExpansion).toBe(null)
  })

  it('setting and reading prefillExpansion works', () => {
    snippetUiState.prefillExpansion = 'hello from clipboard'
    expect(snippetUiState.prefillExpansion).toBe('hello from clipboard')
    // clean up
    snippetUiState.prefillExpansion = null
  })
})
