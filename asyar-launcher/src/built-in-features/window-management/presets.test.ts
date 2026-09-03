import { describe, it, expect } from 'vitest';
import { getPresetBounds, PRESET_IDS, DISPLAY_COMMAND_IDS } from './presets';

const SW = 2560;
const SH = 1440;

describe('getPresetBounds', () => {
  it('left-half fills left 50%', () => {
    const result = getPresetBounds('left-half', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: 0, width: SW / 2, height: SH } });
  });

  it('right-half fills right 50%', () => {
    const result = getPresetBounds('right-half', SW, SH);
    expect(result).toEqual({ bounds: { x: SW / 2, y: 0, width: SW / 2, height: SH } });
  });

  it('top-half fills top 50%', () => {
    const result = getPresetBounds('top-half', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: 0, width: SW, height: SH / 2 } });
  });

  it('bottom-half fills bottom 50%', () => {
    const result = getPresetBounds('bottom-half', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: SH / 2, width: SW, height: SH / 2 } });
  });

  it('top-left-quarter fills top-left 25%', () => {
    const result = getPresetBounds('top-left-quarter', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: 0, width: SW / 2, height: SH / 2 } });
  });

  it('top-right-quarter fills top-right 25%', () => {
    const result = getPresetBounds('top-right-quarter', SW, SH);
    expect(result).toEqual({ bounds: { x: SW / 2, y: 0, width: SW / 2, height: SH / 2 } });
  });

  it('bottom-left-quarter fills bottom-left 25%', () => {
    const result = getPresetBounds('bottom-left-quarter', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: SH / 2, width: SW / 2, height: SH / 2 } });
  });

  it('bottom-right-quarter fills bottom-right 25%', () => {
    const result = getPresetBounds('bottom-right-quarter', SW, SH);
    expect(result).toEqual({ bounds: { x: SW / 2, y: SH / 2, width: SW / 2, height: SH / 2 } });
  });

  it('left-third fills left 33%', () => {
    const result = getPresetBounds('left-third', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: 0, width: SW / 3, height: SH } });
  });

  it('center-third fills center 33%', () => {
    const result = getPresetBounds('center-third', SW, SH);
    expect(result).toEqual({ bounds: { x: SW / 3, y: 0, width: SW / 3, height: SH } });
  });

  it('right-third fills right 33%', () => {
    const result = getPresetBounds('right-third', SW, SH);
    expect(result).toEqual({ bounds: { x: (SW / 3) * 2, y: 0, width: SW / 3, height: SH } });
  });

  it('left-two-thirds fills left 66%', () => {
    const result = getPresetBounds('left-two-thirds', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: 0, width: (SW / 3) * 2, height: SH } });
  });

  it('right-two-thirds fills right 66%', () => {
    const result = getPresetBounds('right-two-thirds', SW, SH);
    expect(result).toEqual({ bounds: { x: SW / 3, y: 0, width: (SW / 3) * 2, height: SH } });
  });

  it('center is 80% centered', () => {
    const result = getPresetBounds('center', SW, SH);
    expect(result).toEqual({
      bounds: { x: SW * 0.1, y: SH * 0.1, width: SW * 0.8, height: SH * 0.8 },
    });
  });

  it('first-fourth fills first 25% column', () => {
    const result = getPresetBounds('first-fourth', SW, SH);
    expect(result).toEqual({ bounds: { x: 0, y: 0, width: SW / 4, height: SH } });
  });

  it('second-fourth fills second 25% column', () => {
    const result = getPresetBounds('second-fourth', SW, SH);
    expect(result).toEqual({ bounds: { x: SW / 4, y: 0, width: SW / 4, height: SH } });
  });

  it('third-fourth fills third 25% column', () => {
    const result = getPresetBounds('third-fourth', SW, SH);
    expect(result).toEqual({ bounds: { x: (SW / 4) * 2, y: 0, width: SW / 4, height: SH } });
  });

  it('last-fourth fills last 25% column', () => {
    const result = getPresetBounds('last-fourth', SW, SH);
    expect(result).toEqual({ bounds: { x: (SW / 4) * 3, y: 0, width: SW / 4, height: SH } });
  });

  it('almost-maximize is 90% centered', () => {
    const result = getPresetBounds('almost-maximize', SW, SH);
    expect(result).toEqual({
      bounds: { x: SW * 0.05, y: SH * 0.05, width: SW * 0.9, height: SH * 0.9 },
    });
  });

  it('maximize returns fullscreen:true and no bounds', () => {
    const result = getPresetBounds('maximize', SW, SH);
    expect(result).toEqual({ fullscreen: true });
  });

  it('returns null for unknown preset id', () => {
    const result = getPresetBounds('nonexistent', SW, SH);
    expect(result).toBeNull();
  });

  it('PRESET_IDS contains all 20 layout preset ids', () => {
    expect(PRESET_IDS).toHaveLength(20);
    expect(PRESET_IDS).toContain('left-half');
    expect(PRESET_IDS).toContain('maximize');
    expect(PRESET_IDS).toContain('first-fourth');
    expect(PRESET_IDS).toContain('second-fourth');
    expect(PRESET_IDS).toContain('third-fourth');
    expect(PRESET_IDS).toContain('last-fourth');
    expect(PRESET_IDS).not.toContain('restore');
    expect(PRESET_IDS).not.toContain('manage-layouts');
  });

  it('DISPLAY_COMMAND_IDS contains multi-display command ids', () => {
    expect(DISPLAY_COMMAND_IDS).toHaveLength(2);
    expect(DISPLAY_COMMAND_IDS).toContain('previous-display');
    expect(DISPLAY_COMMAND_IDS).toContain('next-display');
  });
});
