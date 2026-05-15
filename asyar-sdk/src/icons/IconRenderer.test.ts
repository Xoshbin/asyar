import { describe, it, expect } from 'vitest';
import { renderIcon, listIcons, hasIcon, getIconData } from './IconRenderer';
import { ICON_DATA, ICON_NAMES } from './iconData';

describe('IconRenderer', () => {
  describe('renderIcon', () => {
    it('returns SVG string for valid icon name', () => {
      const svg = renderIcon('calculator');
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('</svg>');
    });

    it('returns empty string for unknown icon name', () => {
      expect(renderIcon('nonexistent-icon')).toBe('');
    });

    it('applies custom size', () => {
      const svg = renderIcon('calculator', { size: 16 });
      expect(svg).toContain('width="16"');
      expect(svg).toContain('height="16"');
    });

    it('applies custom strokeWidth', () => {
      const svg = renderIcon('calculator', { strokeWidth: 2 });
      expect(svg).toContain('stroke-width="2"');
    });

    it('applies custom class', () => {
      const svg = renderIcon('calculator', { class: 'my-icon' });
      expect(svg).toContain('class="my-icon"');
    });

    it('uses default size 20 and strokeWidth 1.5', () => {
      const svg = renderIcon('calculator');
      expect(svg).toContain('width="20"');
      expect(svg).toContain('height="20"');
      expect(svg).toContain('stroke-width="1.5"');
    });

    it('includes fill="none" and round line caps', () => {
      const svg = renderIcon('calculator');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke-linecap="round"');
      expect(svg).toContain('stroke-linejoin="round"');
    });

    it('omits class attribute when not provided', () => {
      const svg = renderIcon('calculator');
      expect(svg).not.toContain('class=');
    });
  });

  describe('listIcons', () => {
    it('returns an array of icon names', () => {
      const names = listIcons();
      expect(names.length).toBeGreaterThan(20);
      expect(names).toContain('calculator');
      expect(names).toContain('settings');
    });
  });

  describe('hasIcon', () => {
    it('returns true for existing icon', () => {
      expect(hasIcon('calculator')).toBe(true);
    });

    it('returns false for nonexistent icon', () => {
      expect(hasIcon('nonexistent')).toBe(false);
    });
  });

  describe('getIconData', () => {
    it('returns SVG content for existing icon', () => {
      const data = getIconData('calculator');
      expect(data).toBeDefined();
      expect(data).toContain('<rect');
    });

    it('returns undefined for nonexistent icon', () => {
      expect(getIconData('nonexistent')).toBeUndefined();
    });
  });

  describe('ICON_DATA', () => {
    it('contains all expected icons', () => {
      expect(ICON_DATA).toHaveProperty('calculator');
      expect(ICON_DATA).toHaveProperty('ai-chat');
      expect(ICON_DATA).toHaveProperty('settings');
      expect(ICON_DATA).toHaveProperty('store');
    });

    it('includes server icon (used by MCP manifest)', () => {
      expect(hasIcon('server')).toBe(true);
      const data = getIconData('server');
      expect(data).toBeDefined();
      expect(data).toMatch(/<rect|<path|<line/);
    });

    it('includes terminal icon (used by Scripts manifest + script fallback)', () => {
      expect(hasIcon('terminal')).toBe(true);
      const data = getIconData('terminal');
      expect(data).toBeDefined();
      expect(data).toMatch(/<polyline|<path|<line/);
    });
  });

  describe('ICON_NAMES', () => {
    it('matches keys of ICON_DATA', () => {
      expect([...ICON_NAMES].sort()).toEqual(Object.keys(ICON_DATA).sort());
    });
  });
});
