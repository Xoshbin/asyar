---
order: 12
---

# Built-in Tools Reference

Eight Tier 1 tools are registered at launcher startup and are available to any agent running on a tool-capable provider. Their fully-qualified IDs follow the pattern `builtin:<bare-id>`.

**Wire encoding.** Provider APIs (including Anthropic) restrict tool names to `^[a-zA-Z0-9_-]{1,64}$`. The agent loop encodes FQIDs before sending them: `:` becomes `__` and `.` becomes `--`. A per-request map decodes incoming `tool_use.name` values back to FQIDs before invocation. Source: `src/built-in-features/agents/agentLoop.ts`, `encodeToolIdForWire` (line 556).

Example: `builtin:calculator` is sent to Anthropic as `builtin__calculator`.

---

## Master table

| Fully-qualified ID | Display name | Required args | Optional args | Return shape |
|---|---|---|---|---|
| `builtin:calculator` | Calculator | `expression` | — | scalar (number, string, or boolean) |
| `builtin:clipboard-read` | Clipboard Read | — | — | `{ text }` |
| `builtin:clipboard-write` | Clipboard Write | `text` | — | `{ ok }` |
| `builtin:fs-read` | Read File | `path` | — | `{ content }` |
| `builtin:fs-write` | Write File | `path`, `content` | — | `{ ok, bytesWritten }` |
| `builtin:shell-exec` | Run Shell Command | `command` | `args`, `cwd` | `{ stdout, stderr, exitCode }` |
| `builtin:web-fetch` | Fetch URL | `url` | `method`, `headers`, `body`, `timeoutMs` | `{ status, statusText, headers, body, ok }` |
| `builtin:search` | Search Launcher Index | `query` | `limit` | `{ results[] }` |

---

## builtin:calculator

Evaluates a mathematical expression using [evalexpr](https://docs.rs/evalexpr).

### Parameters

```json
{
  "type": "object",
  "properties": {
    "expression": {
      "type": "string",
      "description": "Math expression to evaluate, e.g. '2 + 2 * 3'"
    }
  },
  "required": ["expression"]
}
```

### Returns

A scalar JSON value — integer, float, string, or boolean — depending on what `evalexpr` produces:

```
42          // integer result
3.14        // float result
"hello"     // string result
true        // boolean result
```

### Notes

- Tuple and empty results are rejected with an `AppError::Validation`.
- Malformed expressions return `Err` (agent receives a tool error, not a tool result).

---

## builtin:clipboard-read

Reads the current text content of the OS clipboard via `arboard`.

### Parameters

```json
{
  "type": "object",
  "properties": {}
}
```

No arguments required or accepted.

### Returns

```json
{ "text": "<clipboard contents>" }
```

### Notes

- Returns the raw text from the clipboard at invocation time. If the clipboard holds non-text data, `arboard` returns an error and the tool returns `Err`.

---

## builtin:clipboard-write

Writes text to the OS clipboard via `arboard`.

### Parameters

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "The text to write to the clipboard."
    }
  },
  "required": ["text"]
}
```

### Returns

```json
{ "ok": true }
```

### Notes

- Overwrites whatever the clipboard currently holds.
- A missing or non-string `text` argument returns `Err` before touching the clipboard.

---

## builtin:fs-read

Reads a UTF-8 text file at the given path using `std::fs::read_to_string`.

### Parameters

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "Absolute path to the file." }
  },
  "required": ["path"]
}
```

### Returns

```json
{ "content": "<file contents as UTF-8 string>" }
```

### Notes

- **No path sandboxing.** The tool calls `std::fs::read_to_string(path)` directly. It inherits the launcher process's filesystem permissions and has no built-in path restriction. There is no prefix check, no `canonicalize`-then-allowlist, and no glob filter.
- Files that are not valid UTF-8 cause `read_to_string` to fail; the tool returns `Err`.
- A relative path is resolved against the launcher process's current working directory, which is platform-dependent. Prefer absolute paths.

---

## builtin:fs-write

Writes UTF-8 text to a file at the given path using `std::fs::write`. Overwrites any existing file.

### Parameters

```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string", "description": "Absolute path to the file." },
    "content": { "type": "string", "description": "Text content to write." }
  },
  "required": ["path", "content"]
}
```

### Returns

```json
{ "ok": true, "bytesWritten": 1234 }
```

`bytesWritten` is the byte length of the UTF-8 encoded `content` string.

### Notes

- **No path sandboxing.** Same caveats as `builtin:fs-read` — no prefix check, no allowlist.
- Creates the file if it does not exist. The parent directory must already exist; `std::fs::write` does not create intermediate directories.
- Overwrites existing files silently.

---

## builtin:shell-exec

Spawns an OS process via Tokio's `Command` and returns its stdio output and exit code.

### Parameters

```json
{
  "type": "object",
  "properties": {
    "command": { "type": "string", "description": "Executable to run." },
    "args":    { "type": "array", "items": {"type": "string"}, "description": "Arguments." },
    "cwd":     { "type": "string", "description": "Working directory (optional)." }
  },
  "required": ["command"]
}
```

### Returns

```json
{
  "stdout": "<stdout as UTF-8 string>",
  "stderr": "<stderr as UTF-8 string>",
  "exitCode": 0
}
```

`exitCode` is an integer when the process exited normally, or `null` when the process was killed by a signal (Unix only).

### Notes

- **A non-zero exit code is not an error.** `invoke()` returns `Ok` in all cases where the process was successfully spawned. The agent must inspect `exitCode` to determine success or failure. Only failure to spawn the process (e.g. executable not found) returns `Err`.
- `stdout` and `stderr` are decoded with `String::from_utf8_lossy` — invalid UTF-8 bytes are replaced with the Unicode replacement character.
- `args` is optional and defaults to an empty list. All entries must be strings; a non-string entry returns `Err` before spawning.
- `cwd` is optional. If omitted, the process inherits the launcher's working directory.

---

## builtin:web-fetch

Performs an HTTP request using `reqwest` and returns the response envelope.

### Parameters

```json
{
  "type": "object",
  "properties": {
    "url":       { "type": "string", "description": "Absolute http(s) URL." },
    "method":    { "type": "string", "description": "HTTP method (default GET)." },
    "headers":   { "type": "object", "description": "String-string headers." },
    "body":      { "type": "string", "description": "Request body." },
    "timeoutMs": { "type": "number", "description": "Timeout in milliseconds." }
  },
  "required": ["url"]
}
```

### Returns

```json
{
  "status": 200,
  "statusText": "OK",
  "headers": { "content-type": "text/html" },
  "body": "<response body as string>",
  "ok": true
}
```

`ok` is `true` when `status` is in the 2xx range.

### Notes

- **No SSRF guard in the tool path.** `WebFetchTool::invoke()` calls `network::service::fetch()` directly, which does not call `validate_url_for_ssrf`. The SSRF guard (`validate_url_for_ssrf` in `src-tauri/src/network/service.rs`) is only enforced on the `fetch_url` Tauri command used by Tier 2 extensions via the SDK `NetworkService`. Agents invoking this tool can reach private IP ranges and localhost.
- Default timeout is 20 000 ms. Pass `timeoutMs` to override.
- Connect timeout is always 10 s regardless of `timeoutMs`.
- `method` defaults to `GET`. Unrecognized methods (anything other than `POST`, `PUT`, `DELETE`, `PATCH`) are treated as `GET`.
- `headers` must be a flat object of string → string. Nested values return `Err`.
- The response body is read as text via `reqwest`'s `.text()` method. Binary responses are returned but may contain replacement characters.

---

## builtin:search

Queries the launcher's in-memory frecency-ranked search index.

### Parameters

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "Search query." },
    "limit": { "type": "number", "description": "Max results to return (default 10)." }
  },
  "required": ["query"]
}
```

### Returns

```json
{
  "results": [
    { "id": "app_com.apple.Finder", "name": "Finder", "type": "application", "score": 42.0 },
    { "id": "cmd_builtin_calculator", "name": "Calculator", "type": "command", "score": 18.5 }
  ]
}
```

Each result item: `id` (object_id from the index), `name`, `type`, `score` (frecency score).

### Notes

- `SearchTool` holds an `Arc<SearchState>` that is captured at registration time during `setup_app`. It always reflects the live index — `SearchState` is the shared mutable state that the launcher's indexer updates in place.
- `limit` defaults to `10`. Negative values return `Err`. Zero is valid and returns an empty `results` array.
- `limit` must be an integer; a non-integer number returns `Err`.
- Results are returned in descending score order (highest frecency first), then truncated to `limit`. The ranking is identical to what the user sees in the launcher search bar.

---

## Adding a 9th built-in tool — contributor recipe

Built-in tools are compiled into the launcher binary (Tier 1). This is distinct from the Tier 2 path, where extension authors declare tools in their manifest and implement handlers in a worker iframe. See [`../how-to/register-extension-tools.md`](../how-to/register-extension-tools.md) for the Tier 2 approach.

### Steps

**1. Implement `BuiltinTool`.**

Create a new file under `src-tauri/src/agents/builtin_tools/`. Implement the `BuiltinTool` trait from `crate::agents::tools`:

```rust
#[async_trait::async_trait]
pub trait BuiltinTool: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;
    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError>;
}
```

`descriptor()` must return a `ToolDescriptor` with:
- `id`: bare id, no colons (e.g. `"my-tool"`).
- `fully_qualified_id`: `"builtin:my-tool"`.
- `source`: `ToolSource::Builtin`.
- `parameters`: a valid JSON Schema object.

**2. Declare the module.**

Add `pub mod my_tool;` to `src-tauri/src/agents/builtin_tools/mod.rs`.

**3. Register at startup.**

The registration site is `register_builtin_tools()` in `src-tauri/src/lib.rs` (line 568). This function is called from `setup_app` at line 782. Add one call:

```rust
registry.register_builtin(Arc::new(MyTool::new()))
    .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
```

`register_builtin` returns `Err` if a tool with the same bare id is already registered, so duplicate ids fail at startup rather than silently replacing an existing tool.

**4. Add a sibling test file.**

Follow the pattern of existing test files (e.g. `src-tauri/src/agents/builtin_tools/calculator_test.rs`). Cover at minimum: descriptor shape, required-arg validation, and the happy-path return value.

Declare the test module in `mod.rs`:

```rust
#[cfg(test)]
mod my_tool_test;
```

**Contrast with Tier 2.** A Tier 2 extension tool lives outside the launcher binary, is declared in `manifest.json`, and runs as JavaScript in a sandboxed worker iframe. The launcher routes invocations over IPC. Built-in tools run as Rust code inside the launcher process with no sandbox and no manifest declaration.
