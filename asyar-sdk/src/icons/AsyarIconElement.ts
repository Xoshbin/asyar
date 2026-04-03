import { renderIcon } from './IconRenderer';

const HTMLElementClass = typeof HTMLElement !== 'undefined' ? HTMLElement : class {} as unknown as typeof HTMLElement;

export class AsyarIconElement extends HTMLElementClass {
  static observedAttributes = ['name', 'size', 'stroke-width'];

  connectedCallback() {
    if (this.style) {
      this.style.display = 'inline-flex';
      this.style.alignItems = 'center';
      this.style.justifyContent = 'center';
    }
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    const name = this.getAttribute('name') || '';
    const sizeAttr = this.getAttribute('size');
    const size = sizeAttr ? parseInt(sizeAttr, 10) : 20;
    const strokeWidthAttr = this.getAttribute('stroke-width');
    const strokeWidth = strokeWidthAttr ? parseFloat(strokeWidthAttr) : 1.5;

    this.innerHTML = renderIcon(name, { size, strokeWidth });
  }
}

/** Register the <asyar-icon> custom element. Safe to call multiple times. */
export function registerIconElement(tagName?: string): void {
  const tag = tagName || 'asyar-icon';
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, AsyarIconElement);
  }
}
