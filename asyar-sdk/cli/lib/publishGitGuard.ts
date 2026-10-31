import { execFileSync } from 'child_process';
import { isOwnGitRoot } from './extensionRepo';

/**
 * `asyar publish` builds the zip from local files, but the GitHub tag it
 * creates — and every file the Store reads at that tag — comes from
 * whatever is on GitHub. These checks make both the same commit: the
 * working tree must be clean, HEAD must be pushed, and the release then
 * tags HEAD exactly.
 *
 * - `ok`: safe to publish; tag `headSha`.
 * - `blocked`: local state would publish something other than the zip.
 * - `unverifiable`: there is no local repo for this extension to compare
 *   (e.g. `--repo` from a plain folder), so publish keeps its old
 *   behavior and the caller only warns.
 */
export type PublishGitCheck =
  | { status: 'ok'; headSha: string }
  | { status: 'blocked'; reason: string; hint: string }
  | { status: 'unverifiable'; reason: string };

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

const MAX_LISTED_FILES = 10;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
}

function tryGit(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

/** Parses `owner/repo` out of any common GitHub remote URL form. */
export function parseGitHubRepo(url: string): GitHubRepoRef | null {
  const match = url.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function sameRepo(a: GitHubRepoRef, b: GitHubRepoRef): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}

export function checkPublishGitState(cwd: string, target: GitHubRepoRef): PublishGitCheck {
  if (!isOwnGitRoot(cwd)) {
    return {
      status: 'unverifiable',
      reason: 'this folder is not its own git repository',
    };
  }

  // Raw config value on purpose: `git remote get-url` expands insteadOf
  // rewrites, which would hide which GitHub repo origin really names.
  const originUrl = tryGit(cwd, 'config', '--get', 'remote.origin.url');
  const origin = originUrl ? parseGitHubRepo(originUrl) : null;
  if (!origin || !sameRepo(origin, target)) {
    return {
      status: 'unverifiable',
      reason: `the git remote "origin" is not github.com/${target.owner}/${target.repo}`,
    };
  }

  const headSha = tryGit(cwd, 'rev-parse', 'HEAD');
  if (!headSha) {
    return {
      status: 'blocked',
      reason: 'This repository has no commits yet.',
      hint: 'Commit your extension, push it, then run "asyar publish" again.',
    };
  }

  // Untracked files count: a new source file the build picked up would
  // be in the zip but not on GitHub. Ignored files (dist/) never show.
  // Not via git(): trimming would eat the first line's leading status column.
  const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  if (changes.length > 0) {
    const listed = changes.slice(0, MAX_LISTED_FILES).map((file) => `    ${file}`);
    if (changes.length > MAX_LISTED_FILES) {
      listed.push(`    …and ${changes.length - MAX_LISTED_FILES} more`);
    }
    return {
      status: 'blocked',
      reason: `You have changes that are not committed:\n${listed.join('\n')}`,
      hint: 'Commit (or discard) them and push, so the Store shows exactly what you publish.',
    };
  }

  const branch = tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  const upstream = tryGit(cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  if (!upstream) {
    return {
      status: 'blocked',
      reason: branch
        ? `The branch "${branch}" has never been pushed to GitHub.`
        : 'You are not on a branch (detached HEAD), so this commit is not on GitHub.',
      hint: branch
        ? `Run: git push -u origin ${branch}`
        : 'Switch to your branch, push it, then run "asyar publish" again.',
    };
  }

  // HEAD only has to be reachable from the upstream; being behind is fine
  // because the commit we tag is already on GitHub.
  if (tryGit(cwd, 'merge-base', '--is-ancestor', 'HEAD', upstream) === null) {
    return {
      status: 'blocked',
      reason: `Your current commit is not pushed to ${upstream} yet.`,
      hint: 'Run: git push (if you already pushed from somewhere else, run git fetch first)',
    };
  }

  return { status: 'ok', headSha };
}

/**
 * A resumed publish reuses a release that already exists, and GitHub
 * ignores `target_commitish` when the tag already exists. Either way the
 * existing tag must point at the commit being published, or the zip and
 * the Store would describe different code.
 */
export function checkReleaseTagMatchesHead(
  releaseTag: string,
  tagSha: string,
  headSha: string,
): { status: 'ok' } | { status: 'blocked'; reason: string; hint: string } {
  if (tagSha === headSha) return { status: 'ok' };
  return {
    status: 'blocked',
    reason:
      `The tag ${releaseTag} already exists on GitHub, but it points at commit ${tagSha.slice(0, 7)}, ` +
      `not your current commit ${headSha.slice(0, 7)}.`,
    hint: 'Bump the version in manifest.json, or delete that tag (and its release) on GitHub, then publish again.',
  };
}
