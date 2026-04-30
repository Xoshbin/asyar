import mermaid from 'mermaid';

let initialized = false;

/**
 * Initialize Mermaid with Asyar's design system tokens.
 */
export async function initMermaid() {
  if (initialized) return;
  
  // Get CSS variable values for themes
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    fontFamily: 'var(--font-ui)',
    themeVariables: {
      primaryColor: '#2EC4B6',
      primaryTextColor: '#fff',
      primaryBorderColor: '#2EC4B6',
      lineColor: '#637777',
      secondaryColor: '#28B0A3',
      tertiaryColor: 'var(--bg-tertiary)',
    }
  });
  
  initialized = true;
}

/**
 * Render all mermaid diagrams in a given container.
 * @param container The element containing .mermaid blocks
 */
export async function renderMermaidDiagrams(container: HTMLElement) {
  if (!container) return;
  
  const blocks = container.querySelectorAll('.mermaid:not([data-processed="true"])');
  if (blocks.length === 0) return;
  
  await initMermaid();
  
  try {
    await mermaid.run({
      nodes: Array.from(blocks) as HTMLElement[],
    });
    
    blocks.forEach(block => {
      block.setAttribute('data-processed', 'true');
      // Add a class for styling the rendered SVG
      const svg = block.querySelector('svg');
      if (svg) {
        svg.style.maxWidth = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
        svg.style.margin = '0 auto';
      }
    });
  } catch (e) {
    console.error('[mermaid] Rendering failed:', e);
  }
}
