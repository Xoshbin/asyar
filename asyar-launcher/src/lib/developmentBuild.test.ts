import { describe, expect, it } from 'vitest';
import { getDevelopmentBuildIndicator } from './developmentBuild';

describe('development build indicator', () => {
  it('describes development builds', () => {
    expect(getDevelopmentBuildIndicator(true)).toEqual({
      text: 'DEV',
      title: 'Development build',
    });
  });

  it('stays absent from production builds', () => {
    expect(getDevelopmentBuildIndicator(false)).toBeNull();
  });
});
