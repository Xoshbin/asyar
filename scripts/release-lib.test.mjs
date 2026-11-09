import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { computeNextVersion, VERSION_KEYWORDS } from './release-lib.mjs';

test('patch/minor/major bump from a stable version', () => {
  assert.equal(computeNextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(computeNextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(computeNextVersion('1.2.3', 'major'), '2.0.0');
});
test('beta from a stable version starts a numeric prerelease', () => {
  assert.equal(computeNextVersion('1.2.3', 'beta'), '1.2.4-0');
});
test('beta from an existing prerelease increments the prerelease number', () => {
  assert.equal(computeNextVersion('1.2.4-0', 'beta'), '1.2.4-1');
});
test('explicit numeric-prerelease version is accepted verbatim', () => {
  assert.equal(computeNextVersion('1.2.3', '2.0.0-1'), '2.0.0-1');
});
test('explicit non-numeric prerelease is rejected (Windows/WiX)', () => {
  assert.throws(() => computeNextVersion('1.2.3', '2.0.0-beta'), /numeric-only/);
});
test('garbage input is rejected', () => {
  assert.throws(() => computeNextVersion('1.2.3', 'banana'), /Invalid version/);
});
test('VERSION_KEYWORDS is the canonical keyword list', () => {
  assert.deepEqual(VERSION_KEYWORDS, ['patch', 'minor', 'major', 'beta']);
});

import {
  makeExec,
  assertCleanTree,
  assertTagNotOnRemote,
  assertStableBetaReadiness,
  defaultPrompt,
  releaseViaPr,
} from './release-lib.mjs';

function fakeExec({ captures = {}, dryRun = false } = {}) {
  const ran = [];
  return {
    ran,
    run(cmd) {
      ran.push(cmd);
    },
    runQuiet(cmd) {
      ran.push(`(quiet) ${cmd}`);
    },
    capture(cmd) {
      for (const [needle, out] of Object.entries(captures)) {
        if (cmd.includes(needle)) return out;
      }
      return '';
    },
    dryRun,
  };
}

test('assertCleanTree throws when the tree is dirty', () => {
  const exec = fakeExec({ captures: { 'git status --porcelain': ' M file.txt' } });
  assert.throws(() => assertCleanTree(exec, '/repo'), /not clean/);
});
test('assertCleanTree passes when clean', () => {
  const exec = fakeExec({ captures: { 'git status --porcelain': '' } });
  assert.doesNotThrow(() => assertCleanTree(exec, '/repo'));
});
test('assertTagNotOnRemote throws when the tag already exists', () => {
  const exec = fakeExec({ captures: { 'ls-remote': 'abc123\trefs/tags/v1.2.3' } });
  assert.throws(() => assertTagNotOnRemote(exec, 'v1.2.3', '/repo'), /already exists/);
});
test('releaseViaPr runs branch→add→commit→tag→push in order', () => {
  const exec = fakeExec();
  releaseViaPr(exec, {
    cwd: '/repo',
    tag: 'sdk-v3.1.1',
    branch: 'release/sdk-v3.1.1',
    files: ['asyar-sdk/package.json', 'pnpm-lock.yaml'],
    commitMessage: 'chore(sdk): release 3.1.1',
    prTitle: 'release 3.1.1',
    prBody: 'release',
  });
  const order = exec.ran.join('\n');
  assert.match(
    order,
    /checkout -b release\/sdk-v3\.1\.1[\s\S]*git add[\s\S]*git commit[\s\S]*git tag sdk-v3\.1\.1[\s\S]*git push/,
  );
});
test('makeExec in dry-run records but does not execute mutating commands', () => {
  const logs = [];
  const exec = makeExec({ dryRun: true, log: (m) => logs.push(m) });
  exec.run('git push origin main v9.9.9', '/repo');
  assert.ok(logs.some((l) => l.includes('[dry-run]') && l.includes('git push')));
});

test('assertStableBetaReadiness skips prerelease target versions', async () => {
  const exec = fakeExec();
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2-0',
    });
  });
});

test('assertStableBetaReadiness notices when no beta tag exists and aborts if declined', async () => {
  const logs = [];
  const exec = fakeExec({ captures: { 'git tag -l': '' } });
  await assert.rejects(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      prompt: async () => false,
      log: (m) => logs.push(m),
    });
  }, /Release aborted by user/);
  assert.ok(logs.some((l) => l.includes('No prior beta')));
});

test('assertStableBetaReadiness notices when no beta tag exists and proceeds if confirmed', async () => {
  const logs = [];
  const exec = fakeExec({ captures: { 'git tag -l': '' } });
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      prompt: async () => true,
      log: (m) => logs.push(m),
    });
  });
  assert.ok(logs.some((l) => l.includes('No prior beta')));
});

test('assertStableBetaReadiness proceeds when no beta tag exists if yes: true', async () => {
  const logs = [];
  const exec = fakeExec({ captures: { 'git tag -l': '' } });
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      yes: true,
      log: (m) => logs.push(m),
    });
  });
  assert.ok(logs.some((l) => l.includes('--yes passed')));
});

test('assertStableBetaReadiness logs dryRun info when no beta tag exists', async () => {
  const logs = [];
  const exec = fakeExec({ captures: { 'git tag -l': '' }, dryRun: true });
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      log: (m) => logs.push(m),
    });
  });
  assert.ok(logs.some((l) => l.includes('[dry-run] Would prompt')));
});

test('assertStableBetaReadiness passes cleanly when last beta tag exists and 0 commits since', async () => {
  const logs = [];
  const exec = fakeExec({
    captures: {
      'git tag -l': 'v0.1.2-0',
      'git log': '',
    },
  });
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      log: (m) => logs.push(m),
    });
  });
  assert.ok(logs.some((l) => l.includes('No new commits on main')));
});

test('assertStableBetaReadiness warns of new commits since last beta and aborts if declined', async () => {
  const logs = [];
  const exec = fakeExec({
    captures: {
      'git tag -l': 'v0.1.2-1\nv0.1.2-0',
      'git log': 'a1b2c3d fix: bug\ne4f5g6h feat: cool',
    },
  });
  await assert.rejects(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      prompt: async () => false,
      log: (m) => logs.push(m),
    });
  }, /Release aborted by user/);
  assert.ok(logs.some((l) => l.includes('2 commits were merged to main since the last beta')));
  assert.ok(logs.some((l) => l.includes('a1b2c3d fix: bug')));
});

test('assertStableBetaReadiness warns of new commits since last beta and proceeds if confirmed', async () => {
  const logs = [];
  const exec = fakeExec({
    captures: {
      'git tag -l': 'v0.1.2-0',
      'git log': 'a1b2c3d fix: bug',
    },
  });
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      prompt: async () => true,
      log: (m) => logs.push(m),
    });
  });
  assert.ok(logs.some((l) => l.includes('1 commit was merged to main')));
});

test('assertStableBetaReadiness warns of new commits and proceeds when yes: true', async () => {
  const logs = [];
  const exec = fakeExec({
    captures: {
      'git tag -l': 'v0.1.2-0',
      'git log': 'a1b2c3d fix: bug',
    },
  });
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      yes: true,
      log: (m) => logs.push(m),
    });
  });
  assert.ok(logs.some((l) => l.includes('--yes passed')));
});

test('assertStableBetaReadiness logs dryRun info when commits exist since last beta', async () => {
  const logs = [];
  const exec = fakeExec({
    captures: {
      'git tag -l': 'v0.1.2-0',
      'git log': 'a1b2c3d fix: bug',
    },
    dryRun: true,
  });
  await assert.doesNotReject(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      log: (m) => logs.push(m),
    });
  });
  assert.ok(logs.some((l) => l.includes('[dry-run] Would prompt')));
});

test('defaultPrompt confirms yes and rejects closed input stream', async () => {
  const yesStream = Readable.from(['yes\n']);
  const devNull = new Writable({
    write(_c, _e, cb) {
      cb();
    },
  });
  const confirmed = await defaultPrompt('Confirm? ', { input: yesStream, output: devNull });
  assert.equal(confirmed, true);

  const closedStream = Readable.from([]);
  await assert.rejects(async () => {
    await defaultPrompt('Confirm? ', { input: closedStream, output: devNull });
  }, /Confirmation input closed/);
});

test('assertStableBetaReadiness fails closed if git commands throw an error', async () => {
  const exec = {
    dryRun: false,
    capture(cmd) {
      if (cmd.includes('git tag')) throw new Error('git tag lookup fatal error');
      return '';
    },
  };
  await assert.rejects(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
    });
  }, /git tag lookup fatal error/);
});

test('assertStableBetaReadiness detects commits on main even if HEAD has no commits', async () => {
  const logs = [];
  const exec = fakeExec({
    captures: {
      'git tag -l': 'v0.1.2-0',
      'git rev-parse --verify main': 'abc123',
      'git log': 'e4f5g6h fix(main): commit on main',
    },
  });
  await assert.rejects(async () => {
    await assertStableBetaReadiness(exec, {
      cwd: '/repo',
      targetVersion: '0.1.2',
      prompt: async () => false,
      log: (m) => logs.push(m),
    });
  }, /Release aborted by user/);
  assert.ok(logs.some((l) => l.includes('e4f5g6h fix(main): commit on main')));
});
