# Asyar Extension Authoring Guide (for the AI builder)

You are building a Tier-2 (sandboxed iframe) Asyar extension. You MUST stay
within the capabilities in `capabilities.json`. If the user's request needs a
capability that is not listed, declare the request INFEASIBLE.

## Extension shape
An extension is a directory with `manifest.json`, a `package.json`, a Vite
build, and source under `src/`. A command is either `mode: "view"` (renders a
Svelte component named by `component`) or `mode: "background"` (runs in the
always-on worker; requires `background.main`).

## Manifest rules (validated by the launcher — get these right or it is rejected)
- `id` dot-notation (e.g. `com.author.tool`), `version` semver, `type` is
  `"extension"` or `"theme"`.
- Every `mode: "view"` command MUST set a non-empty `component`.
- Every `mode: "background"` command MUST NOT set `component`, and the manifest
  MUST set `background.main`.
- `permissions[]` may only contain strings from `capabilities.json.permissions`.
- `preferences[].type` MUST be one of `capabilities.json.preferenceTypes`
  (note: a text input is `"textfield"`, NOT `"text"`).
- `preferences[].name` matches `^[a-zA-Z_][a-zA-Z0-9_]*$`; `dropdown` requires `data`.

## AI tools
An extension may expose AI tools to the Asyar chat agent via a `tools[]` array
in the manifest. Any extension that declares `tools[]` MUST also declare the
`tools:register` permission — without it the tools are silently rejected.

## Secrets
Any third-party API key the extension needs at runtime MUST be a
`password` preference the end-user fills in. NEVER hardcode a key into source.

## Permission notes
`store:read` / `store:write` are inert legacy slugs the validator still accepts
but gate nothing — use `storage:read` / `storage:write` for persistence.

## Patterns to copy
Canonical, current example extensions are provided as URLs in your build
instructions — fetch them with WebFetch and copy real patterns (worker owns
network/state, views render worker-provided data, AI tools expose read-only
capabilities). Do not assume; read the actual manifest + source.
