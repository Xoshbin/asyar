<script lang="ts">
  import {
    externalSearchUrl,
    searchSuggestionsDocument,
    isSearchSuggestionsMessage,
  } from './googleSearchSuggestions';
  import { t } from '../../services/i18n';

  let { html, onOpen }: { html: string; onOpen: (url: string) => void } = $props();
  let frame = $state<HTMLIFrameElement>();
  let src = $state('');
  let token = $state('');
  let height = $state(120);

  $effect(() => {
    const nonce = crypto.randomUUID();
    token = nonce;
    const document = searchSuggestionsDocument(html, nonce);
    const url = URL.createObjectURL(new Blob([document], { type: 'text/html' }));
    src = url;
    return () => URL.revokeObjectURL(url);
  });

  function receive(event: MessageEvent) {
    if (!isSearchSuggestionsMessage(event, frame?.contentWindow, token)) return;
    if (event.data?.type === 'google-search-size' && Number.isFinite(event.data.height)) {
      height = Math.max(1, Math.min(2000, event.data.height));
    } else if (event.data?.type === 'google-search-link') {
      const url = externalSearchUrl(event.data.url);
      if (url) onOpen(url);
    }
  }
</script>

<svelte:window onmessage={receive} />
{#if src}
  <iframe
    bind:this={frame}
    {src}
    title={t('features.agents.google_search_suggestions')}
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    style:height="{height}px"
  ></iframe>
{/if}

<style>
  iframe {
    display: block;
    width: 100%;
    border: 0;
    margin-top: var(--space-3);
  }
</style>
