import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import {
  isOwnGitRoot,
  findEnclosingParentOrigin,
  ensureInitialCommit,
  ensureExtensionGitignore,
} from './extensionRepo'

/**
 * These helpers all shell out to real `git`, so the tests use real temp
 * directories with real `git init` instead of mocking child_process —
 * mocking would let us pass while the actual command surface drifts.
 */

let tmpRoot: string

function mkTmp(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `asyar-${label}-`))
}

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.join(' ')}`, { cwd, stdio: 'pipe' })
    .toString()
    .trim()
}

beforeEach(() => {
  tmpRoot = mkTmp('extensionRepo-test')
  // Identity is required for `git commit` to work in CI environments
  // that don't have a global user.{name,email} set.
  process.env.GIT_AUTHOR_NAME = 'Test'
  process.env.GIT_AUTHOR_EMAIL = 'test@example.com'
  process.env.GIT_COMMITTER_NAME = 'Test'
  process.env.GIT_COMMITTER_EMAIL = 'test@example.com'
})

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('isOwnGitRoot', () => {
  it('returns false for a directory that has no .git anywhere', () => {
    expect(isOwnGitRoot(tmpRoot)).toBe(false)
  })

  it('returns true when cwd IS the git repo root', () => {
    git(tmpRoot, 'init', '-b', 'main')
    expect(isOwnGitRoot(tmpRoot)).toBe(true)
  })

  it('returns false when cwd is a SUBDIRECTORY of a git repo', () => {
    git(tmpRoot, 'init', '-b', 'main')
    const sub = path.join(tmpRoot, 'nested', 'deeper')
    fs.mkdirSync(sub, { recursive: true })
    expect(isOwnGitRoot(sub)).toBe(false)
  })

  it('returns true for a child git repo nested inside a parent git repo', () => {
    git(tmpRoot, 'init', '-b', 'main')
    const child = path.join(tmpRoot, 'child')
    fs.mkdirSync(child)
    git(child, 'init', '-b', 'main')
    expect(isOwnGitRoot(child)).toBe(true)
  })
})

describe('findEnclosingParentOrigin', () => {
  it('returns null when not inside any git repo', () => {
    expect(findEnclosingParentOrigin(tmpRoot)).toBeNull()
  })

  it('returns null when inside a git repo with no origin remote', () => {
    git(tmpRoot, 'init', '-b', 'main')
    const sub = path.join(tmpRoot, 'sub')
    fs.mkdirSync(sub)
    expect(findEnclosingParentOrigin(sub)).toBeNull()
  })

  it('returns parent origin when cwd is a subdirectory', () => {
    git(tmpRoot, 'init', '-b', 'main')
    git(tmpRoot, 'remote', 'add', 'origin', 'https://github.com/acme/parent.git')
    const sub = path.join(tmpRoot, 'extensions', 'foo')
    fs.mkdirSync(sub, { recursive: true })
    expect(findEnclosingParentOrigin(sub)).toBe('https://github.com/acme/parent')
  })

  it('normalizes git@github.com:owner/name.git to https://github.com/owner/name', () => {
    git(tmpRoot, 'init', '-b', 'main')
    git(tmpRoot, 'remote', 'add', 'origin', 'git@github.com:acme/parent.git')
    const sub = path.join(tmpRoot, 'sub')
    fs.mkdirSync(sub)
    expect(findEnclosingParentOrigin(sub)).toBe('https://github.com/acme/parent')
  })

  it('when cwd is its own git root, walks UP and returns the parent monorepo origin', () => {
    // Simulates extensions/memory inside the launcher monorepo: child
    // has its own .git (possibly orphan from a prior publish attempt),
    // parent has a github origin that should NOT be confused with the
    // child extension's repo.
    git(tmpRoot, 'init', '-b', 'main')
    git(tmpRoot, 'remote', 'add', 'origin', 'https://github.com/acme/monorepo')
    const child = path.join(tmpRoot, 'child')
    fs.mkdirSync(child)
    git(child, 'init', '-b', 'main')
    expect(isOwnGitRoot(child)).toBe(true)
    expect(findEnclosingParentOrigin(child)).toBe('https://github.com/acme/monorepo')
  })

  it('returns null when cwd is its own git root and has no enclosing parent', () => {
    git(tmpRoot, 'init', '-b', 'main')
    git(tmpRoot, 'remote', 'add', 'origin', 'https://github.com/acme/x')
    // No parent git repo exists above tmpRoot's containing tmp dir
    // (os.tmpdir() is not a git repo), so result is null.
    expect(findEnclosingParentOrigin(tmpRoot)).toBeNull()
  })
})

describe('ensureInitialCommit', () => {
  it('is a no-op when HEAD already resolves', () => {
    git(tmpRoot, 'init', '-b', 'main')
    fs.writeFileSync(path.join(tmpRoot, 'a.txt'), 'hello')
    git(tmpRoot, 'add', '.')
    git(tmpRoot, 'commit', '-m', 'first')
    const beforeHead = git(tmpRoot, 'rev-parse', 'HEAD')

    ensureInitialCommit(tmpRoot)
    const afterHead = git(tmpRoot, 'rev-parse', 'HEAD')
    expect(afterHead).toBe(beforeHead) // unchanged
  })

  it('creates an initial commit when the repo has no commits yet', () => {
    git(tmpRoot, 'init', '-b', 'main')
    fs.writeFileSync(path.join(tmpRoot, 'manifest.json'), '{}')
    // No commits → git rev-parse HEAD fails
    expect(() => git(tmpRoot, 'rev-parse', 'HEAD')).toThrow()

    ensureInitialCommit(tmpRoot)
    const head = git(tmpRoot, 'rev-parse', 'HEAD')
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    expect(git(tmpRoot, 'log', '-1', '--pretty=%s')).toBe('Initial extension')
  })
})

describe('ensureExtensionGitignore', () => {
  it('writes a default .gitignore when none exists', () => {
    ensureExtensionGitignore(tmpRoot)
    const content = fs.readFileSync(path.join(tmpRoot, '.gitignore'), 'utf8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('dist/')
    expect(content).toContain('*.log')
  })

  it('leaves an existing .gitignore untouched', () => {
    const userContent = '# my custom rules\nfoo/\n'
    fs.writeFileSync(path.join(tmpRoot, '.gitignore'), userContent)
    ensureExtensionGitignore(tmpRoot)
    expect(fs.readFileSync(path.join(tmpRoot, '.gitignore'), 'utf8')).toBe(userContent)
  })
})
