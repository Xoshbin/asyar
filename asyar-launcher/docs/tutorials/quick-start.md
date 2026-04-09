## 3. Quick Start — Hello World in Under 5 Minutes

The fastest path to a running extension is the **built-in "Create Extension" tool** inside Asyar. It scaffolds the entire project, installs dependencies, runs the first build, and registers the extension for development — automatically.

### Method A: Using the Create Extension UI (Recommended)

1. Open Asyar (press your configured launch hotkey).
2. Type **"Create Extension"** in the search bar and press Enter.
3. Fill in the form:
   - **Name**: `Hello World`
   - **ID**: `com.yourname.hello-world`
   - **Description**: `A minimal Asyar extension that says hello.`
   - **Save Location**: choose any directory on your machine
   - **Extension Type**: `View` (opens a UI panel)
4. Click **Generate**.

Asyar will:
- Resolve the latest `asyar-sdk` version from npm
- Write all project files from templates
- Run `pnpm install`
- Run `pnpm run build`
- Register your project path in the development registry
- Open VS Code (or your default file manager)

Your extension is **immediately available** in Asyar. Open the launcher, type `Hello World`, press Enter, and the view renders.

> **See the [Create Extension tool guide](../how-to/use-create-extension-tool.md) for the full Create Extension reference, including all three extension types and what each template produces.**

---
