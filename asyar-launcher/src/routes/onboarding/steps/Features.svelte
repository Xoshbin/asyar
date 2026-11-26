<script lang="ts">
  import type { Component } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Icon } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';
  import { TOUR_SLIDES, type TourSlideId } from './features/featureTour';
  import { SAMPLE_EXPANSION, SAMPLE_KEYWORD } from './snippetsSetup';
  import ClipboardSlide from './features/ClipboardSlide.svelte';
  import SnippetsSlide from './features/SnippetsSlide.svelte';
  import EmojiSlide from './features/EmojiSlide.svelte';
  import AiSlide from './features/AiSlide.svelte';
  import FilesSlide from './features/FilesSlide.svelte';
  import WindowSlide from './features/WindowSlide.svelte';
  import MiniLauncherDemo from './features/MiniLauncherDemo.svelte';
  import TypingDemo from './features/TypingDemo.svelte';

  const SLIDES: Record<TourSlideId, { icon: string; wide: boolean; sandbox: Component }> = {
    clipboard: { icon: 'clipboard', wide: true, sandbox: ClipboardSlide },
    snippets: { icon: 'snippets', wide: false, sandbox: SnippetsSlide },
    emoji: { icon: 'type', wide: false, sandbox: EmojiSlide },
    ai: { icon: 'sparkles', wide: true, sandbox: AiSlide },
    files: { icon: 'folder-search', wide: false, sandbox: FilesSlide },
    window: { icon: 'window', wide: true, sandbox: WindowSlide },
  };

  // null shows the bento grid with every feature animating; an id opens that feature live.
  let open = $state<TourSlideId | null>(null);
  const index = $derived(open ? TOUR_SLIDES.indexOf(open) : -1);
  const isLast = $derived(index === TOUR_SLIDES.length - 1);

  $effect(() => {
    if (!open) {
      onboardingNav.set({ onPrimary: advanceStep });
      return;
    }
    onboardingNav.set({
      glyph: SLIDES[open].icon,
      primaryOnModEnter: true,
      primaryLabel: isLast ? t('onboarding.tour.all_features') : t('onboarding.tour.next'),
      onPrimary: () => {
        open = isLast ? null : TOUR_SLIDES[index + 1];
      },
      onBack: () => {
        open = null;
      },
    });
  });

  // A button clicked on the way here keeps focus, so plain Enter would natively click
  // whatever that button says now; on a live feature only ⌘↵ advances.
  $effect(() => {
    void open;
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
  });
</script>

{#if open}
  {@const Sandbox = SLIDES[open].sandbox}
  {#key open}
    <div class="feature" in:fly={{ x: 24, duration: 280, easing: cubicOut }}>
      <div class="feature__header">
        <h1 class="feature__title">{t(`onboarding.tour.${open}_title`)}</h1>
        <p class="feature__desc">{t(`onboarding.tour.${open}_desc`)}</p>
      </div>
      <div class="feature__stage">
        <Sandbox />
      </div>
      <p class="feature__tip">{t(`onboarding.tour.${open}_tip`)}</p>
    </div>
  {/key}
{:else}
  <div class="bento-wrap">
    <h1 class="feature__title">{t('onboarding.features_heading')}</h1>
    <div class="bento">
      {#each TOUR_SLIDES as id, i (id)}
        <button
          class="bento__tile"
          class:bento__tile--wide={SLIDES[id].wide}
          style:--i={i}
          onclick={() => (open = id)}
        >
          <span class="bento__head">
            <Icon name={SLIDES[id].icon} size={14} />
            <span class="bento__name">{t(`onboarding.tour.${id}_title`)}</span>
            <span class="bento__try">{t('onboarding.tour.try_it')} →</span>
          </span>
          <span class="bento__demo">
            {#if id === 'clipboard'}
              <MiniLauncherDemo
                query={t('onboarding.tour.reel_clipboard_query')}
                rows={[
                  { icon: 'icon:clipboard', title: t('onboarding.tour.reel_clipboard_row1') },
                  { icon: 'icon:clipboard', title: t('onboarding.tour.reel_clipboard_row2') },
                ]}
              />
            {:else if id === 'snippets'}
              <TypingDemo
                before={`${t('onboarding.tour.snippets_demo_prefix')} ${SAMPLE_KEYWORD}`}
                after={`${t('onboarding.tour.snippets_demo_prefix')} ${SAMPLE_EXPANSION}`}
              />
            {:else if id === 'emoji'}
              <TypingDemo
                before={`${t('onboarding.tour.reel_emoji_text')} :rocket:`}
                after={`${t('onboarding.tour.reel_emoji_text')} 🚀`}
              />
            {:else if id === 'ai'}
              <TypingDemo
                before={t('onboarding.tour.ai_sample')}
                after={t('onboarding.tour.ai_fixed')}
              />
            {:else if id === 'files'}
              <MiniLauncherDemo
                query={t('onboarding.tour.reel_files_query')}
                rows={[
                  { icon: 'icon:file-text', title: t('onboarding.tour.reel_files_row1') },
                  { icon: 'icon:folder', title: t('onboarding.tour.reel_files_row2') },
                ]}
              />
            {:else}
              <WindowSlide />
            {/if}
          </span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .feature,
  .bento-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .feature__header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    text-align: center;
  }
  .feature__title {
    margin: 0;
    text-align: center;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .feature__desc {
    margin: 0;
    max-width: 46ch;
    font-size: var(--font-size-md);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .feature__stage {
    border: 1px solid var(--separator);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    overflow: hidden;
  }
  .feature__tip {
    margin: 0;
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .bento {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }
  .bento__tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    border: 1px solid var(--separator);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    overflow: hidden;
    text-align: left;
    font: inherit;
    cursor: default;
    transition: border-color var(--dur-quick) var(--ease-travel);
    animation: tile-in var(--dur-emerge) var(--ease-emerge) both;
    animation-delay: calc(120ms + var(--i) * 60ms);
  }
  .bento__tile--wide {
    grid-column: span 2;
  }
  .bento__tile:hover,
  .bento__tile:focus-visible {
    border-color: color-mix(in srgb, var(--asyar-brand) 55%, transparent);
  }
  .bento__head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) 0;
    color: var(--asyar-brand);
  }
  .bento__name {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .bento__try {
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0;
    transition: opacity var(--dur-quick) var(--ease-travel);
  }
  .bento__tile:hover .bento__try,
  .bento__tile:focus-visible .bento__try {
    opacity: 1;
  }
  /* Demos are sized for the full stage; tiles show them at 75% so all six fit one screen. */
  .bento__demo {
    --tile-demo-h: calc(var(--font-size-md) * 8.5);
    display: block;
    height: var(--tile-demo-h);
    overflow: hidden;
    pointer-events: none;
  }
  .bento__demo > :global(*) {
    width: calc(100% / 0.75);
    transform: scale(0.75);
    transform-origin: top left;
  }
  .bento__demo :global(.mini-launcher-demo) {
    min-height: 0;
    padding: var(--space-3) var(--space-4);
  }
  .bento__demo :global(.typing-demo) {
    min-height: 0;
  }
  .bento__demo :global(.window-slide) {
    padding: var(--space-2) var(--space-4);
  }
  .bento__demo :global(.window-slide__desk) {
    aspect-ratio: auto;
    height: calc(var(--tile-demo-h) / 0.75 - var(--space-2) * 2);
  }
  @keyframes tile-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.98);
    }
  }
</style>
