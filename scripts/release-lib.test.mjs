import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeNextVersion, VERSION_KEYWORDS } from './release-lib.mjs'

test('patch/minor/major bump from a stable version', () => {
  assert.equal(computeNextVersion('1.2.3', 'patch'), '1.2.4')
  assert.equal(computeNextVersion('1.2.3', 'minor'), '1.3.0')
  assert.equal(computeNextVersion('1.2.3', 'major'), '2.0.0')
})
test('beta from a stable version starts a numeric prerelease', () => {
  assert.equal(computeNextVersion('1.2.3', 'beta'), '1.2.4-0')
})
test('beta from an existing prerelease increments the prerelease number', () => {
  assert.equal(computeNextVersion('1.2.4-0', 'beta'), '1.2.4-1')
})
test('explicit numeric-prerelease version is accepted verbatim', () => {
  assert.equal(computeNextVersion('1.2.3', '2.0.0-1'), '2.0.0-1')
})
test('explicit non-numeric prerelease is rejected (Windows/WiX)', () => {
  assert.throws(() => computeNextVersion('1.2.3', '2.0.0-beta'), /numeric-only/)
})
test('garbage input is rejected', () => {
  assert.throws(() => computeNextVersion('1.2.3', 'banana'), /Invalid version/)
})
test('VERSION_KEYWORDS is the canonical keyword list', () => {
  assert.deepEqual(VERSION_KEYWORDS, ['patch', 'minor', 'major', 'beta'])
})

import {
  makeExec, assertCleanTree, assertTagNotOnRemote, releaseViaPr,
} from './release-lib.mjs'

function fakeExec({ captures = {}, dryRun = false } = {}) {
  const ran = []
  return {
    ran,
    run(cmd) { ran.push(cmd) },
    runQuiet(cmd) { ran.push(`(quiet) ${cmd}`) },
    capture(cmd) {
      for (const [needle, out] of Object.entries(captures)) {
        if (cmd.includes(needle)) return out
      }
      return ''
    },
    dryRun,
  }
}

test('assertCleanTree throws when the tree is dirty', () => {
  const exec = fakeExec({ captures: { 'git status --porcelain': ' M file.txt' } })
  assert.throws(() => assertCleanTree(exec, '/repo'), /not clean/)
})
test('assertCleanTree passes when clean', () => {
  const exec = fakeExec({ captures: { 'git status --porcelain': '' } })
  assert.doesNotThrow(() => assertCleanTree(exec, '/repo'))
})
test('assertTagNotOnRemote throws when the tag already exists', () => {
  const exec = fakeExec({ captures: { 'ls-remote': 'abc123\trefs/tags/v1.2.3' } })
  assert.throws(() => assertTagNotOnRemote(exec, 'v1.2.3', '/repo'), /already exists/)
})
test('releaseViaPr runs branch→add→commit→tag→push in order', () => {
  const exec = fakeExec()
  releaseViaPr(exec, {
    cwd: '/repo', tag: 'sdk-v3.1.1', branch: 'release/sdk-v3.1.1',
    files: ['asyar-sdk/package.json', 'pnpm-lock.yaml'],
    commitMessage: 'chore(sdk): release 3.1.1',
    prTitle: 'release 3.1.1', prBody: 'release',
  })
  const order = exec.ran.join('\n')
  assert.match(order, /checkout -b release\/sdk-v3\.1\.1[\s\S]*git add[\s\S]*git commit[\s\S]*git tag sdk-v3\.1\.1[\s\S]*git push/)
})
test('makeExec in dry-run records but does not execute mutating commands', () => {
  const logs = []
  const exec = makeExec({ dryRun: true, log: (m) => logs.push(m) })
  exec.run('git push origin main v9.9.9', '/repo')
  assert.ok(logs.some((l) => l.includes('[dry-run]') && l.includes('git push')))
})
