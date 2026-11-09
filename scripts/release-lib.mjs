import semver from 'semver';

export const VERSION_KEYWORDS = ['patch', 'minor', 'major', 'beta'];

// Windows MSI/WiX requires any pre-release identifier to be numeric-only.
const EXPLICIT_VERSION_RE = /^\d+\.\d+\.\d+(-[0-9]+(\.[0-9]+)*)?$/;

export function computeNextVersion(currentVersion, input) {
  if (VERSION_KEYWORDS.includes(input)) {
    if (input === 'beta') {
      return currentVersion.includes('-')
        ? semver.inc(currentVersion, 'prerelease')
        : semver.inc(currentVersion, 'prepatch');
    }
    return semver.inc(currentVersion, input);
  }
  if (!EXPLICIT_VERSION_RE.test(input)) {
    throw new Error(
      `Invalid version: "${input}". Windows compatibility requires any ` +
        `pre-release suffix to be numeric-only (use "0.1.0-1", not "0.1.0-beta").`,
    );
  }
  return input;
}

import { execSync } from 'node:child_process';
import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { createInterface } from 'node:readline/promises';

export function makeExec({ dryRun = false, log = console.log } = {}) {
  return {
    dryRun,
    run(cmd, cwd) {
      if (dryRun) {
        log(`[dry-run] ${cmd}`);
        return;
      }
      execSync(cmd, { cwd, stdio: 'inherit' });
    },
    runQuiet(cmd, cwd) {
      if (dryRun) {
        log(`[dry-run] ${cmd}`);
        return;
      }
      try {
        execSync(cmd, { cwd, stdio: 'pipe' });
      } catch {
        /* best-effort */
      }
    },
    capture(cmd, cwd) {
      return execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim();
    },
  };
}

export function assertCleanTree(exec, cwd) {
  if (exec.capture('git status --porcelain', cwd)) {
    throw new Error('Working tree is not clean. Commit or stash changes before releasing.');
  }
}

export function assertTagNotOnRemote(exec, tag, cwd) {
  const existing = exec.capture(`git ls-remote --tags origin refs/tags/${tag}`, cwd);
  if (existing) {
    throw new Error(
      `Tag ${tag} already exists on the remote. This version was already released. ` +
        `Bump to a higher version, or delete the tag to re-release.`,
    );
  }
}

async function defaultPrompt(question) {
  const rl = createInterface({ input: defaultInput, output: defaultOutput });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function assertStableBetaReadiness(
  exec,
  { cwd, targetVersion, yes = false, prompt = null, log = console.log } = {},
) {
  // Only stable releases (without pre-release hyphen) need beta readiness verification.
  if (targetVersion.includes('-')) {
    return;
  }

  const ask = prompt ?? defaultPrompt;

  let tagOutput = '';
  try {
    tagOutput = exec.capture(`git tag -l "v${targetVersion}-*" --sort=-v:refname`, cwd);
  } catch {
    tagOutput = '';
  }

  const tags = tagOutput
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean);

  if (tags.length === 0) {
    log(`\n⚠️  Notice: No prior beta (v${targetVersion}-*) was found for this version.`);
    log(`   You are releasing ${targetVersion} directly to Stable without prior beta testing.\n`);

    if (exec.dryRun) {
      log(
        `[dry-run] Would prompt: "Continue releasing ${targetVersion} directly to Stable? [y/N]"`,
      );
      return;
    }

    if (yes) {
      log(`✓ Proceeding directly to Stable (--yes passed).`);
      return;
    }

    const confirmed = await ask(`Continue releasing ${targetVersion} directly to Stable? [y/N] `);
    if (!confirmed) {
      throw new Error('Release aborted by user.');
    }
    return;
  }

  const latestBetaTag = tags[0];
  let logOutput = '';
  try {
    logOutput = exec.capture(`git log ${latestBetaTag}..HEAD --oneline`, cwd);
  } catch {
    logOutput = '';
  }

  const commits = logOutput
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean);

  if (commits.length === 0) {
    log(`✓ Last beta was ${latestBetaTag}. No new commits on main.`);
    return;
  }

  const count = commits.length;
  const commitSummary = count === 1 ? '1 commit was' : `${count} commits were`;
  log(`\n⚠️  Warning: ${commitSummary} merged to main since the last beta (${latestBetaTag}):`);
  const displayCommits = commits.slice(0, 10);
  for (const c of displayCommits) {
    log(`   - ${c}`);
  }
  if (commits.length > 10) {
    log(`   ... and ${commits.length - 10} more commits`);
  }
  log('');

  if (exec.dryRun) {
    log(
      `[dry-run] Would prompt: "Do you want to include these in Stable ${targetVersion} directly? [y/N]"`,
    );
    return;
  }

  if (yes) {
    log(`✓ Proceeding with ${count} un-tested commit(s) in Stable (--yes passed).`);
    return;
  }

  const confirmed = await ask(
    `Do you want to include these in Stable ${targetVersion} directly? [y/N] `,
  );
  if (!confirmed) {
    throw new Error('Release aborted by user.');
  }
}

export function releaseViaPr(exec, { cwd, tag, branch, files, commitMessage, prTitle, prBody }) {
  exec.runQuiet(`git branch -D ${branch}`, cwd);
  exec.runQuiet(`git tag -d ${tag}`, cwd);
  exec.run(`git checkout -b ${branch}`, cwd);
  exec.run(`git add ${files.join(' ')}`, cwd);
  exec.run(`git commit -m ${JSON.stringify(commitMessage)}`, cwd);
  exec.run(`git tag ${tag}`, cwd);
  exec.run(`git push origin ${branch} ${tag}`, cwd);
  let prUrl = '';
  if (!exec.dryRun) {
    try {
      prUrl = exec.capture(
        `gh pr create --base main --head ${branch} ` +
          `--title ${JSON.stringify(prTitle)} --body ${JSON.stringify(prBody)}`,
        cwd,
      );
    } catch {
      /* gh missing or PR exists; maintainer opens it manually */
    }
  }
  exec.runQuiet('git checkout main', cwd);
  return prUrl;
}

export function syncLockfile(exec, monorepoRoot) {
  exec.run('pnpm install', monorepoRoot);
}
