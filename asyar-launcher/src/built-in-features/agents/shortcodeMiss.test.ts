import { describe, expect, it } from 'vitest';
import { resolveShortcodeMissAgent } from './shortcodeMiss';

describe('resolveShortcodeMissAgent', () => {
  it('returns null when no agents match inputSource shortcodeMiss', () => {
    const agents = [
      { id: '1', inputSource: 'direct', shortcodeTrigger: ':' },
      { id: '2', inputSource: 'selection', shortcodeTrigger: ':' },
    ];
    expect(resolveShortcodeMissAgent(agents, ':hello:')).toBeNull();
  });

  it('ignores agents with blank or whitespace-only shortcode triggers', () => {
    const agents = [
      { id: '1', inputSource: 'shortcodeMiss', shortcodeTrigger: '' },
      { id: '2', inputSource: 'shortcodeMiss', shortcodeTrigger: '   ' },
    ];
    expect(resolveShortcodeMissAgent(agents, ':hello:')).toBeNull();
  });

  it('matches single-character trigger and extracts user text', () => {
    const agents = [{ id: 'agent-colon', inputSource: 'shortcodeMiss', shortcodeTrigger: ':' }];
    const match = resolveShortcodeMissAgent(agents, ':translate_me:');
    expect(match).toEqual({
      agent: agents[0],
      trigger: ':',
      userText: 'translate_me',
    });
  });

  it('prioritizes the longest matching trigger when multiple triggers match', () => {
    const agents = [
      { id: 'agent-single', inputSource: 'shortcodeMiss', shortcodeTrigger: ':' },
      { id: 'agent-double', inputSource: 'shortcodeMiss', shortcodeTrigger: '::' },
    ];

    // '::prompt::' matches both ':' and '::', but '::' is longer and must win
    const match = resolveShortcodeMissAgent(agents, '::prompt::');
    expect(match).not.toBeNull();
    expect(match?.agent.id).toBe('agent-double');
    expect(match?.trigger).toBe('::');
    expect(match?.userText).toBe('prompt');
  });

  it('routes to single trigger when candidate only matches single trigger', () => {
    const agents = [
      { id: 'agent-single', inputSource: 'shortcodeMiss', shortcodeTrigger: ':' },
      { id: 'agent-double', inputSource: 'shortcodeMiss', shortcodeTrigger: '::' },
    ];

    const match = resolveShortcodeMissAgent(agents, ':prompt:');
    expect(match).not.toBeNull();
    expect(match?.agent.id).toBe('agent-single');
    expect(match?.trigger).toBe(':');
    expect(match?.userText).toBe('prompt');
  });

  it('handles untrimmed shortcode payloads', () => {
    const agents = [{ id: '1', inputSource: 'shortcodeMiss', shortcodeTrigger: ';' }];
    const match = resolveShortcodeMissAgent(agents, '  ;query;  ');
    expect(match).toEqual({
      agent: agents[0],
      trigger: ';',
      userText: 'query',
    });
  });
});
