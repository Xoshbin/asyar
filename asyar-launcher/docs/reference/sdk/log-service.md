### 8.1 `LogService` — Structured logging

**Permission required:** None.

```typescript
interface ILogService {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string | Error): void;
  custom(message: string, category: string, colorName: string, frameName?: string): void;
}
```

**Usage:**
```typescript
const log = context.getService<ILogService>('LogService');

log.debug('Rendering item list');
log.info('Extension initialized');
log.warn('Rate limit approaching');
log.error(new Error('API request failed'));
log.custom('User selected item #3', 'UI', 'cyan', 'MyExtension');
```

Log messages appear in Asyar's developer log panel (accessible from the tray menu).

**Guidelines:**
- Use `debug` freely during development for trace-level output.
- Use `info` for lifecycle events (initialize, activate, first data load).
- Use `warn` for recoverable edge cases (fallback values, deprecated usage).
- Use `error` only for actual failures that affect behavior.
- `custom` lets you add a color and category label for visual grouping in the log panel.

---
