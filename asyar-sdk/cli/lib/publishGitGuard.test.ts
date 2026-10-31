import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { checkPublishGitState, checkReleaseTagMatchesHead } from './publishGitGuard';

/**
 * Real `git` against temp repos, like extensionRepo.test.ts. The "GitHub"
 * remote is a local bare repo reached through `url.<path>.insteadOf`, so
 * `remote.origin.url` still reads as a github.com URL while pushes land
 * on disk.
 */

const REPO = { owner: 'acme', repo: 'asyar-timer-extension' };
const GITHUB_URL = `https://github.com/${REPO.owner}/${REPO.repo}`;

let tmpRoot: string;
let work: string;
let bare: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

function write(rel: string, content: string): void {
  const full = path.join(work, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commitAll(message: string): void {
  git(work, 'add', '-A');
  git(work, 'commit', '-m', message);
}

/** Work repo with one commit pushed to the fake GitHub remote. */
function initPublishedRepo(originUrl = GITHUB_URL): void {
  git(bare, 'init', '--bare', '-b', 'main');
  git(work, 'init', '-b', 'main');
  git(work, 'config', `url.${bare}.insteadOf`, originUrl);
  git(work, 'remote', 'add', 'origin', originUrl);
  write('.gitignore', 'dist/\n');
  write('manifest.json', '{"id":"com.acme.timer","version":"1.0.0"}\n');
  commitAll('Initial extension');
  git(work, 'push', '-u', 'origin', 'main');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-publishGitGuard-test-'));
  work = path.join(tmpRoot, 'work');
  bare = path.join(tmpRoot, 'remote.git');
  fs.mkdirSync(work);
  fs.mkdirSync(bare);
  process.env.GIT_AUTHOR_NAME = 'Test';
  process.env.GIT_AUTHOR_EMAIL = 'test@example.com';
  process.env.GIT_COMMITTER_NAME = 'Test';
  process.env.GIT_COMMITTER_EMAIL = 'test@example.com';
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('checkPublishGitState', () => {
  it('is ok with the HEAD sha when everything is committed and pushed', () => {
    initPublishedRepo();
    expect(checkPublishGitState(work, REPO)).toEqual({
      status: 'ok',
      headSha: git(work, 'rev-parse', 'HEAD'),
    });
  });

  it('ignores changes to gitignored files such as dist/', () => {
    initPublishedRepo();
    write('dist/index.js', 'console.log("built")\n');
    expect(checkPublishGitState(work, REPO).status).toBe('ok');
  });

  it('accepts the scp-style SSH form of the same GitHub repo', () => {
    initPublishedRepo(`git@github.com:${REPO.owner}/${REPO.repo}.git`);
    expect(checkPublishGitState(work, REPO).status).toBe('ok');
  });

  it('blocks on a modified tracked file and names it', () => {
    initPublishedRepo();
    write('manifest.json', '{"id":"com.acme.timer","version":"1.1.0"}\n');
    const result = checkPublishGitState(work, REPO);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toContain('manifest.json');
  });

  it('blocks on an untracked file, since the build may include it', () => {
    initPublishedRepo();
    write('src/newFeature.ts', 'export {};\n');
    const result = checkPublishGitState(work, REPO);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toContain('src/newFeature.ts');
  });

  it('blocks when the current commit is not pushed', () => {
    initPublishedRepo();
    write('README.md', '# Timer\n');
    commitAll('Add README');
    const result = checkPublishGitState(work, REPO);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.hint).toContain('git push');
  });

  it('blocks when the branch has no upstream yet', () => {
    initPublishedRepo();
    git(work, 'checkout', '-b', 'feature');
    write('README.md', '# Timer\n');
    commitAll('Add README');
    const result = checkPublishGitState(work, REPO);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.hint).toContain('git push -u origin feature');
  });

  it('is ok when local is behind the remote, because HEAD is already on GitHub', () => {
    initPublishedRepo();
    const firstSha = git(work, 'rev-parse', 'HEAD');
    write('README.md', '# Timer\n');
    commitAll('Add README');
    git(work, 'push');
    git(work, 'reset', '--hard', firstSha);
    expect(checkPublishGitState(work, REPO)).toEqual({ status: 'ok', headSha: firstSha });
  });

  it('blocks on a detached HEAD that is not on the remote', () => {
    initPublishedRepo();
    write('README.md', '# Timer\n');
    commitAll('Add README');
    git(work, 'checkout', '--detach');
    expect(checkPublishGitState(work, REPO).status).toBe('blocked');
  });

  it('is unverifiable outside a git repo', () => {
    expect(checkPublishGitState(work, REPO).status).toBe('unverifiable');
  });

  it('is unverifiable inside a parent repo, whose state says nothing about the extension', () => {
    git(tmpRoot, 'init', '-b', 'main');
    expect(checkPublishGitState(work, REPO).status).toBe('unverifiable');
  });

  it('is unverifiable when origin points at a different repo than the one being published', () => {
    initPublishedRepo();
    expect(checkPublishGitState(work, { owner: 'acme', repo: 'other-repo' }).status).toBe(
      'unverifiable',
    );
  });
});

describe('checkReleaseTagMatchesHead', () => {
  const head = 'a'.repeat(40);

  it('is ok when the existing release tag points at HEAD', () => {
    expect(checkReleaseTagMatchesHead('v1.0.0', head, head)).toEqual({ status: 'ok' });
  });

  it('blocks when the existing release tag points at another commit', () => {
    const result = checkReleaseTagMatchesHead('v1.0.0', 'b'.repeat(40), head);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reason).toContain('v1.0.0');
    expect(result.status === 'blocked' && result.hint).toContain('version');
  });
});
