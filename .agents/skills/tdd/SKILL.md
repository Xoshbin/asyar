---
name: tdd
description: Use when implementing any new feature or fixing any bug in this project — both Rust (src-tauri) and TypeScript/Svelte 5 (src). Triggers on phrases like "add X", "fix Y", "implement Z", "change how W works".
---

# Test-Driven Development

Write a failing test first. Then write only enough code to make it pass. No exceptions.

## The Iron Law

**NO IMPLEMENTATION BEFORE A FAILING TEST.**

Write code before a test? Delete it. Start over.

**No exceptions:**

- Not for "trivial" functions
- Not for "obvious" logic
- Not for bug fixes ("I just need to change one line")
- Don't keep it as "reference" while writing tests
- Delete means delete

## RED-GREEN-REFACTOR

```
RED   → Write test → run → watch it FAIL (required)
GREEN → Write minimal code → run → watch it PASS
REFACTOR → Clean up → run → still passes
```

Never skip RED. A test that passes without you writing any implementation is not a TDD test.

## Rust (src-tauri)

**Test location:** inline `#[cfg(test)]` module at the bottom of the same `.rs` file.

**Commands:**

```bash
# Run all tests
cd asyar-launcher/src-tauri && cargo test

# Run tests for one file/module
cargo test <module_name>

# See output from passing tests too
cargo test -- --nocapture
```

**Pattern:**

```rust
pub fn some_function(input: &str) -> Result<String, AppError> {
    // ← implement AFTER tests are written and failing
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Step 1: Write this first, run cargo test, watch it fail
    #[test]
    fn test_some_function_happy_path() {
        let result = some_function("valid input").unwrap();
        assert_eq!(result, "expected output");
    }

    #[test]
    fn test_some_function_error_case() {
        let result = some_function("");
        assert!(result.is_err());
    }

    // Use factory helpers for complex types
    fn make_test_manifest(id: &str) -> ExtensionManifest {
        ExtensionManifest { id: id.to_string(), ..Default::default() }
    }
}
```

## TypeScript / Svelte 5 (src)

**Test location:** colocated `*.test.ts` file (e.g. `src/services/foo/FooService.test.ts`).

**Commands:**

```bash
cd asyar-launcher

# Watch mode during development
pnpm test

# Single run (CI / verify before done)
pnpm test:run
```

**Pattern:**

```typescript
// Step 1: Write this file first, run pnpm test:run, watch it fail
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Import AFTER mocks are declared
import { FooService } from './FooService';
import { invoke } from '@tauri-apps/api/core';

describe('FooService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls invoke with correct command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: '1', name: 'Test' });

    const result = await FooService.getItem('1');

    expect(invoke).toHaveBeenCalledWith('get_item', { id: '1' });
    expect(result.name).toBe('Test');
  });

  it('throws on invoke error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('not found'));
    await expect(FooService.getItem('missing')).rejects.toThrow('not found');
  });
});
```

## Cross-Module & Registry Integration Tests

Unit tests with heavy mocking often hide multi-module bugs (e.g. duplicate action IDs, conflicting registrations across `ActionService` and `ExtensionLoader`).

When a feature interacts across registration boundaries:

1. Write an integration test that boots the real modules together (e.g. `ExtensionLoader` registering manifest actions into `ActionService`).
2. Assert that no duplicate IDs, duplicate shortcuts, or clashing UI labels are produced in the shared registry.

## Quick Reference

| Task                          | Command                                | Location                          |
| ----------------------------- | -------------------------------------- | --------------------------------- |
| Run Rust tests                | `cargo test` (in src-tauri/)           | `*.rs` inline `#[cfg(test)]`      |
| Run launcher TS tests (watch) | `pnpm test` (in asyar-launcher/)       | `src/**/*.test.ts`                |
| Run launcher TS tests (once)  | `pnpm test:run` (in asyar-launcher/)   | `src/**/*.test.ts`                |
| Run SDK tests (once)          | `pnpm test:run` (in asyar-sdk/)        | `src/**/*.test.ts`                |
| Mock Tauri invoke             | `vi.mock('@tauri-apps/api/core', ...)` | top of test file                  |
| Mock globals/env              | `vi.stubGlobal()` / `vi.stubEnv()`     | inside test, restore in afterEach |

## Common Mistakes

| Mistake                                     | Fix                                           |
| ------------------------------------------- | --------------------------------------------- |
| Writing implementation first                | Delete it. Write test first.                  |
| Test passes without implementation          | You wrote the wrong test. It must fail first. |
| Forgetting `vi.mock()` hoisting             | Declare `vi.mock()` before any imports        |
| Not clearing mocks                          | Add `beforeEach(() => vi.clearAllMocks())`    |
| Testing in Svelte component directly        | Extract logic to `.ts` file, test that        |
| Not running `cargo test` after Rust changes | Always verify: `cd src-tauri && cargo test`   |

## Red Flags — STOP and Start Over

- "I'll write the test after, it's a small change"
- "This is just a refactor, tests aren't needed"
- "The bug fix is obvious, I don't need a test"
- "I already know it works"
- "Let me just implement it and then add the test"

**All of these mean: write the test first. No exceptions.**
