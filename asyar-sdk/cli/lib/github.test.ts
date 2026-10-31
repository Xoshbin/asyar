import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitHubClient } from './github';

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHubClient.createRelease', () => {
  it('tags the given commit instead of the default branch tip', async () => {
    const fetchMock = stubFetch({ id: 1, upload_url: 'u', html_url: 'h' });
    await new GitHubClient('t').createRelease('acme', 'ext', {
      tag: 'v1.0.0',
      name: 'Timer v1.0.0',
      body: 'notes',
      targetCommitish: 'abc123',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/ext/releases');
    expect(JSON.parse(init.body).target_commitish).toBe('abc123');
  });

  it('leaves target_commitish out when no commit is given', async () => {
    const fetchMock = stubFetch({ id: 1, upload_url: 'u', html_url: 'h' });
    await new GitHubClient('t').createRelease('acme', 'ext', {
      tag: 'v1.0.0',
      name: 'Timer v1.0.0',
      body: 'notes',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('target_commitish');
  });
});

describe('GitHubClient.getCommitSha', () => {
  it('resolves a tag to the sha of the commit it points at', async () => {
    const fetchMock = stubFetch({ sha: 'f'.repeat(40) });
    const sha = await new GitHubClient('t').getCommitSha('acme', 'ext', 'v1.0.0');
    expect(sha).toBe('f'.repeat(40));
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/ext/commits/v1.0.0');
  });
});
