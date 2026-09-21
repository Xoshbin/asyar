# AI & Agents

> Ask AI, build agents, choose providers, connect web search, and manage threads.

![Agent chat view streaming a reply](../../images/feature-ai-agents-hero.png)
_Figure: the agent chat view streaming a reply._

## What it does

Asyar has a built-in AI assistant that works directly from the search bar. Press `Tab` to enter AI mode, type your question, and press `Enter`. The reply streams in line by line inside a chat view. Every conversation is saved in a thread so you can come back to it later.

Beyond the quick-ask flow, you can create custom **agents** — each agent has its own name, system prompt, AI provider, model, and set of tools it is allowed to use. Agents can also run **silently**: no chat view opens, they just take input (from the launcher bar, selected text, or the clipboard), run in the background, and put the result back (replacing your selection, pasting at the cursor, copying to the clipboard, or showing a HUD message).

## How to use it

### Ask AI quickly

1. Open Asyar with your global hotkey.
2. Type your question (or just start typing and notice the `⇥ Ask AI` hint in the bottom bar).
3. Press `Tab` to enter AI mode — the search bar shows an AI indicator.
4. Press `Enter` to send. The reply streams into the chat view.
5. Keep typing in the search bar and press `Enter` again to continue the conversation.

### Manage agents

1. Search for **Manage Agents** and press `Enter`, or type `manage agents`.
2. Select an agent from the list and press `Enter` to open its chat.
3. To create a new agent, open the action panel with `⌘K` and choose **New Agent**.
4. Fill in the name, optional description, system prompt, provider, model, and which tools the agent can use.
5. Press **Save**.

### Configure AI providers

Before you can use any agent, configure at least one AI provider in **Settings → AI** (`⌘,`):

1. **Cloud & Local API Providers**: Click **+ Add provider** and choose from: **Anthropic**, **OpenAI**, **Google**, **Ollama**, **OpenRouter**, or **Custom**.
2. **Local CLI Providers (Zero-Key Setup)**:
   - If you have Google's `agy` CLI or OpenAI's `codex` CLI installed and authenticated on your machine, Asyar can automatically detect your active accounts.
   - These local CLI connections require no API key and can expose Asyar's `ToolRegistry` as a local MCP server for tool-calling agents.
3. **API Formats**: Newly added OpenAI and Custom providers use the **Responses** API format by default. If an endpoint does not implement `/responses`, choose **Chat Completions (widely compatible)**.
4. **Searchable Model Selector**: When you click **Test & Fetch Models**, Asyar populates the available models. If a provider offers dozens or hundreds of models (e.g. OpenRouter or Ollama), a searchable filter dropdown allows typing to quickly find your model.
5. **Reasoning Controls**: Adjust reasoning effort for models supporting thought tokens (Anthropic Claude 3.7 Sonnet, OpenAI o1/o3-mini, Ollama reasoning models).
6. **Default Provider**: The first provider you configure becomes default automatically. Click the star (★) on any other provider to make it the default for `Tab` in the launcher.

### Web search & grounding

Asyar agents can search the web and ground their answers in real-time information:

- **Built-in Web Search Tool (`builtin:web-search`)**:
  - Available to any agent with tool access.
  - Works out of the box with an **unauthenticated DuckDuckGo fallback** — no search API key required.
  - You can also configure **Brave Search** or **Tavily** API keys in **Settings → AI** for high-volume research and deep extraction.
  - When web search is used, the agent chat displays live search status streaming and renders interactive **source pills** with website favicons and domain previews at the top of the message.
- **Google Search Grounding**:
  - Google Gemini models support direct native Google Search grounding via a toggle on the provider configuration card.
- **OpenAI Hosted Web Search**:
  - On OpenAI providers and compatible Responses API proxies, toggle **Hosted Web Search** to allow native search tools.

### Threads & chat actions

Each agent keeps its conversation history in threads. Inside the chat view:

- Use `↑` / `↓` to move between threads in the sidebar.
- Press `Enter` (with an empty search bar) to open the selected thread.
- Open the action panel (`⌘K`) for quick actions:
  - **Copy Last Response**: Copies the agent's most recent reply as formatted Markdown directly to your clipboard.
  - **New Thread**: Starts a fresh conversation thread.
  - **Delete Current Thread**: Removes the active conversation.
  - **Cancel Run**: Aborts an in-flight streaming response.
- Chat text and code blocks are fully selectable for copying.

## Quick AI commands (silent agents)

A **silent agent** runs in the background with no chat window. You trigger it with a global hotkey, it grabs some input, does its work, and puts the result right back — all without you needing to open the launcher or read a chat thread.

![A silent AI command fixing selected text in place](../../images/feature-ai-agents-silent-command.png)
_Figure: select text in any app, press the hotkey, and a silent agent replaces it with the result._

### The built-in Grammar Fix command

During onboarding, Asyar offers to create a **Grammar Fix** silent agent for you (the "One-keystroke AI commands" step). It is set up with:

- **Input:** the text you have selected in whatever app you are using.
- **Output:** the corrected text replaces your selection instantly.
- **Hotkey:** ⌘⇧L on macOS / Ctrl+Shift+L on Windows and Linux (you can change it at any time).

So the workflow is: select some text → press the hotkey → done. No windows, no copy-paste.

### Create your own silent agents

1. Open Asyar and search for **Manage Agents**, then press `Enter`.
2. Open the action panel with `⌘K` and choose **New Agent**.
3. Fill in the name and the system prompt that tells the agent what to do.
4. Turn on **"Run silently (no chat view)"**.
5. Choose an **input source** — where the agent gets its text:
   - **Argument** — you type the input directly in the launcher bar when you trigger it.
   - **Selected text in the active app** — whatever you have highlighted.
   - **Clipboard contents** — the last thing you copied.
   - **Nothing** — the agent runs with no input (useful for things like "tell me a joke").
6. Choose an **output action** — what happens with the result:
   - **Replace the selection** — rewrites the text you had selected.
   - **Paste at the cursor** — inserts the result where your cursor is.
   - **Copy to clipboard** — puts the result on your clipboard so you can paste it yourself.
   - **Show as a HUD message** — displays a floating notification with the result.
7. Optionally assign a **global hotkey** to this agent so you can trigger it without opening the launcher.
8. Press **Save**.

### Example ideas

| What you want              | Input source  | Output action     |
| -------------------------- | ------------- | ----------------- |
| Fix grammar in an email    | Selected text | Replace selection |
| Translate a paragraph      | Selected text | Replace selection |
| Summarise a copied article | Clipboard     | Show as HUD       |
| Rewrite in a formal tone   | Selected text | Replace selection |
| Explain a term you typed   | Argument      | Show as HUD       |

## Shortcuts & actions

| Action                    | How                                                |
| ------------------------- | -------------------------------------------------- |
| Enter AI mode             | `Tab` from the search bar                          |
| Send a message            | `Enter` (while in AI mode or inside the chat view) |
| Copy Last Response        | `⌘K` → **Copy Last Response**                      |
| Open Manage Agents        | Search "Manage Agents" → `Enter`                   |
| New Agent                 | `⌘K` → **New Agent** (in Manage Agents view)       |
| Edit Agent                | `⌘K` → **Edit Agent**                              |
| Delete Agent              | `⌘K` → **Delete Agent**                            |
| New Thread                | `⌘K` → **New Thread** (in chat view)               |
| Delete Current Thread     | `⌘K` → **Delete Current Thread**                   |
| Cancel a running response | `⌘K` → **Cancel Run**                              |
| Navigate threads          | `↑` / `↓`                                          |

## Tips

- The **Tab continues last thread** toggle in Settings → AI controls whether pressing `Tab` always resumes your most recent conversation or starts fresh each time.
- Silent agents are great for quick text-transformation tasks: grammar fix, translation, summarise selection — trigger from the launcher, result appears instantly.
- When you edit an agent's provider or model, the default agent (the ★ one) is updated too, so `Tab` from the search bar always uses the same model you expect.
- Tools shown in the agent editor come from built-in tools (including `builtin:web-search`, calculator, filesystem, shell) and any MCP servers you have installed. See the [MCP](./mcp.md) page and [Built-in Tools Reference](../../reference/builtin-tools.md) for full details.

## Related

- [MCP](./mcp.md)
- [Built-in Tools Reference](../../reference/builtin-tools.md)
- [Settings](../settings.md)
- [Snippets](./snippets.md)
- [Aliases & Shortcuts](./aliases-and-shortcuts.md)
