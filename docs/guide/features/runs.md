# Runs

> Monitor, inspect, and manage active and past background tasks, scripts, and agent executions.

## What it does

Runs provides a centralized mission control for every background process and asynchronous task launched inside Asyar — including shell scripts, agent execution pipelines, long-running CLI tools, and extension workers.

Instead of wondering if a background script is still running or failing silently, Runs shows a live list of active and recent runs with status pills, execution duration, and real-time streaming output logs.

## How to use it

1. Open Asyar and type `runs` — or select **Runs** from search results.
2. The runs view displays two sections:
   - **Active Runs**: Currently executing processes and background operations.
   - **Recent Runs**: Completed, failed, or cancelled executions from this session.
3. Use `↑` / `↓` to highlight a run. The right-hand detail pane streams real-time stdout and stderr output.
4. Press `Enter` to expand or view full log output.

## Shortcuts & actions

| Action            | Shortcut                                  |
| :---------------- | :---------------------------------------- |
| Open Runs         | `Enter` on Runs                           |
| Open Action Panel | `⌘K`                                      |
| Clear Recent Runs | `⌘K` → Clear Recent                       |
| View Conversation | `⌘K` → View Conversation (for agent runs) |

**Action panel (⌘K) entries while Runs is open:**

- **Cancel Run** — aborts an in-flight background process safely.
- **Clear Recent** — clears completed and terminated execution logs from recent history.
- **View Conversation** — jumps directly to the agent chat thread that initiated the run (for runs spawned by AI agents).

## Tips

- **Real-time output streaming** — Scripts and background processes stream stdout/stderr into the detail pane chunk by chunk without blocking the UI.
- **Agent observability** — When an AI agent executes multi-step tools or runs code, check Runs to inspect raw execution output and verify exit codes.
- **Disabling Runs** — You can turn off the Runs feature in **Settings → Extensions**. When disabled, the `Runs` command, navigation, and view are removed from the launcher. The underlying process execution and task tracking engine in Rust continues to function, allowing Tier 2 extensions with the `runs:track` permission to track tasks and stream output via `IRunService` without disruption.

## Related

- [The Basics](../the-basics.md)
- [Scripts](./scripts.md)
- [AI & Agents](./ai-and-agents.md)
- [Run Tracking Architecture](../../explanation/run-tracking.md)
- [Run Service API](../../reference/sdk/run-service.md)
