// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { pickExtensionIframe } from './extensionIframeSelector';

describe('pickExtensionIframe', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not fall back to the other role when strict delivery is requested', () => {
    const view = document.createElement('iframe');
    view.dataset.extensionId = 'org.example.extension';
    view.dataset.role = 'view';
    document.body.append(view);

    expect(pickExtensionIframe('org.example.extension', 'worker', { fallback: false })).toBeNull();
  });
});
