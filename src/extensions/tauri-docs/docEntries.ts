import type { DocEntry } from "./docSearch";

/**
 * List of Tauri v2 documentation entries
 */
export const tauriDocEntries: DocEntry[] = [
  // Updated Tauri v2 documentation links
const tauriDocs: DocEntry[] = [
    // Getting Started
    {
      title: "Getting Started with Tauri v2",
      url: "https://v2.tauri.app/start/",
      description: "Learn how to set up and create your first Tauri v2 project",
      keywords: ["start", "install", "setup", "getting started", "tauri 2", "v2"],
      category: "guide",
    },
    {
      title: "Prerequisites",
      url: "https://v2.tauri.app/start/prerequisites/",
      description:
        "System requirements and tools needed to develop Tauri applications",
      keywords: ["prerequisites", "requirements", "install", "setup", "tooling"],
      category: "guide",
    },
    {
      title: "Create a Project",
      url: "https://v2.tauri.app/start/create-project/",
      description: "Steps to create a new Tauri v2 project from scratch",
      keywords: ["create", "new", "project", "setup", "initialize", "template"],
      category: "guide",
    },
  
    // Frontend Integration
    {
      title: "Frontend Integration",
      url: "https://v2.tauri.app/start/frontend/",
      description: "Connecting your preferred frontend framework with Tauri",
      keywords: ["frontend", "framework", "integration", "web", "ui"],
      category: "guide",
    },
    {
      title: "SvelteKit Integration",
      url: "https://v2.tauri.app/start/frontend/sveltekit/",
      description: "How to use SvelteKit with Tauri v2",
      keywords: ["sveltekit", "svelte", "frontend", "integration"],
      category: "guide",
    },
    {
      title: "Next.js Integration",
      url: "https://v2.tauri.app/start/frontend/nextjs/",
      description: "How to use Next.js with Tauri v2",
      keywords: ["nextjs", "next", "react", "frontend", "integration"],
      category: "guide",
    },
  
    // Core Concepts
    {
      title: "Architecture",
      url: "https://v2.tauri.app/concept/architecture/",
      description: "Understanding Tauri's architecture and design principles",
      keywords: ["architecture", "design", "structure", "concept"],
      category: "concept",
    },
    {
      title: "Process Model",
      url: "https://v2.tauri.app/concept/process-model/",
      description: "How Tauri manages processes and isolation",
      keywords: ["process", "model", "isolation", "main", "render"],
      category: "concept",
    },
    {
      title: "Inter-Process Communication",
      url: "https://v2.tauri.app/concept/inter-process-communication/",
      description: "Communication between frontend and Rust backend",
      keywords: ["ipc", "communication", "invoke", "command", "events"],
      category: "concept",
    },
  
    // Security
    {
      title: "Security Overview",
      url: "https://v2.tauri.app/security/",
      description: "Overview of Tauri's security features and principles",
      keywords: ["security", "safety", "protection", "overview"],
      category: "security",
    },
    {
      title: "Permissions System",
      url: "https://v2.tauri.app/security/permissions/",
      description: "How to manage and configure permissions in Tauri v2",
      keywords: ["permissions", "security", "allow", "deny", "access"],
      category: "security",
    },
    {
      title: "Capabilities",
      url: "https://v2.tauri.app/security/capabilities/",
      description:
        "Understanding the capabilities system for permissions management",
      keywords: ["capabilities", "capability", "security", "permissions"],
      category: "security",
    },
  
    // Development
    {
      title: "Calling Rust from Frontend",
      url: "https://v2.tauri.app/develop/calling-rust/",
      description: "How to call Rust functions from your frontend code",
      keywords: ["invoke", "command", "call", "rust", "backend", "frontend"],
      category: "api",
    },
    {
      title: "Calling Frontend from Rust",
      url: "https://v2.tauri.app/develop/calling-frontend/",
      description: "How to call JavaScript functions from Rust code",
      keywords: ["emit", "event", "call", "javascript", "frontend", "from rust"],
      category: "api",
    },
    {
      title: "Configuration Files",
      url: "https://v2.tauri.app/develop/configuration-files/",
      description:
        "Configuring your Tauri v2 application with configuration files",
      keywords: ["config", "configuration", "settings", "tauri.conf.json"],
      category: "api",
    },
  
    // Plugins
    {
      title: "Clipboard Plugin",
      url: "https://v2.tauri.app/plugin/clipboard/",
      description: "Access and modify the system clipboard in Tauri v2",
      keywords: ["clipboard", "copy", "paste", "cut", "plugin"],
      category: "plugin",
    },
    {
      title: "Dialog Plugin",
      url: "https://v2.tauri.app/plugin/dialog/",
      description: "Create native dialog boxes in your Tauri v2 application",
      keywords: ["dialog", "message", "alert", "confirm", "save", "open"],
      category: "plugin",
    },
    {
      title: "File System Plugin",
      url: "https://v2.tauri.app/plugin/file-system/",
      description: "Access the file system from your Tauri v2 application",
      keywords: ["fs", "file", "directory", "read", "write"],
      category: "plugin",
    },
    {
      title: "HTTP Client Plugin",
      url: "https://v2.tauri.app/plugin/http-client/",
      description: "Make HTTP requests from your Tauri v2 application",
      keywords: ["http", "fetch", "request", "api", "network"],
      category: "plugin",
    },
    {
      title: "Notification Plugin",
      url: "https://v2.tauri.app/plugin/notification/",
      description: "Send system notifications from your Tauri v2 application",
      keywords: ["notification", "notify", "alert", "toast"],
      category: "plugin",
    },
    {
      title: "Opener Plugin",
      url: "https://v2.tauri.app/plugin/opener/",
      description: "Open files and URLs with system applications",
      keywords: ["open", "url", "file", "browser", "external"],
      category: "plugin",
    },
    {
      title: "OS Info Plugin",
      url: "https://v2.tauri.app/plugin/os-info/",
      description: "Get information about the operating system",
      keywords: ["os", "system", "platform", "version"],
      category: "plugin",
    },
  
    // Distribution
    {
      title: "Application Distribution",
      url: "https://v2.tauri.app/distribute/",
      description:
        "Learn how to package and distribute your Tauri v2 application",
      keywords: ["distribute", "package", "publish", "release"],
      category: "distribute",
    },
    {
      title: "Windows Installer",
      url: "https://v2.tauri.app/distribute/windows-installer/",
      description: "Create Windows installers for your Tauri v2 application",
      keywords: ["windows", "installer", "msi", "exe", "packaging"],
      category: "distribute",
    },
    {
      title: "macOS DMG",
      url: "https://v2.tauri.app/distribute/dmg/",
      description: "Create macOS DMG installers for your Tauri v2 application",
      keywords: ["macos", "dmg", "apple", "packaging", "installer"],
      category: "distribute",
    },
    {
      title: "Linux Packaging",
      url: "https://v2.tauri.app/distribute/appimage/",
      description: "Create Linux AppImage packages for your Tauri v2 application",
      keywords: ["linux", "appimage", "packaging", "installer"],
      category: "distribute",
    },
  
    // Mobile
    {
      title: "Mobile Plugin Development",
      url: "https://v2.tauri.app/develop/plugins/develop-mobile/",
      description: "How to develop plugins for mobile platforms in Tauri v2",
      keywords: ["mobile", "android", "ios", "plugin", "development"],
      category: "mobile",
    },
    {
      title: "Google Play Distribution",
      url: "https://v2.tauri.app/distribute/google-play/",
      description: "Distributing your Tauri v2 app on Google Play Store",
      keywords: ["android", "google play", "store", "mobile", "distribution"],
      category: "mobile",
    },
    {
      title: "App Store Distribution",
      url: "https://v2.tauri.app/distribute/app-store/",
      description: "Distributing your Tauri v2 app on the Apple App Store",
      keywords: ["ios", "app store", "apple", "mobile", "distribution"],
      category: "mobile",
    },
  
    // Additional important docs from the sitemap
  
    // Migration guides
    {
      title: "Migration from Tauri v1",
      url: "https://v2.tauri.app/start/migrate/from-tauri-1/",
      description: "Guide to migrate your application from Tauri v1 to v2",
      keywords: ["migration", "upgrade", "v1", "v2", "convert", "update"],
      category: "guide",
    },
    {
      title: "Migration from Tauri v2 Beta",
      url: "https://v2.tauri.app/start/migrate/from-tauri-2-beta/",
      description:
        "Guide to migrate your application from Tauri v2 Beta to v2 stable",
      keywords: ["migration", "beta", "stable", "upgrade", "update"],
      category: "guide",
    },
  
    // Testing
    {
      title: "Testing in Tauri",
      url: "https://v2.tauri.app/develop/tests/",
      description: "How to write and run tests for your Tauri application",
      keywords: ["tests", "testing", "unit", "integration", "e2e"],
      category: "develop",
    },
    {
      title: "WebDriver Testing",
      url: "https://v2.tauri.app/develop/tests/webdriver/",
      description: "End-to-end testing with WebDriver in Tauri",
      keywords: ["webdriver", "e2e", "testing", "selenium", "automation"],
      category: "develop",
    },
  
    // Plugin development
    {
      title: "Plugin Development",
      url: "https://v2.tauri.app/develop/plugins/",
      description: "Create your own plugins for Tauri",
      keywords: ["plugin", "develop", "create", "custom", "extend"],
      category: "develop",
    },
  
    // Additional plugins
    {
      title: "Store Plugin",
      url: "https://v2.tauri.app/plugin/store/",
      description: "Persistent key-value storage for your Tauri application",
      keywords: ["store", "storage", "persist", "data", "save"],
      category: "plugin",
    },
    {
      title: "Updater Plugin",
      url: "https://v2.tauri.app/plugin/updater/",
      description: "Implement auto-updates in your Tauri application",
      keywords: ["update", "updater", "auto-update", "version"],
      category: "plugin",
    },
    {
      title: "Shell Plugin",
      url: "https://v2.tauri.app/plugin/shell/",
      description: "Execute shell commands from your Tauri application",
      keywords: ["shell", "command", "terminal", "exec", "spawn"],
      category: "plugin",
    },
    {
      title: "Global Shortcut Plugin",
      url: "https://v2.tauri.app/plugin/global-shortcut/",
      description:
        "Register global keyboard shortcuts for your Tauri application",
      keywords: ["shortcut", "hotkey", "keyboard", "global", "keybinding"],
      category: "plugin",
    },
  
    // UI customizations
    {
      title: "Window Customization",
      url: "https://v2.tauri.app/learn/window-customization/",
      description: "Customize window appearance and behavior in Tauri",
      keywords: ["window", "customize", "titlebar", "transparent", "frameless"],
      category: "learn",
    },
    {
      title: "System Tray",
      url: "https://v2.tauri.app/learn/system-tray/",
      description: "Add a system tray icon to your Tauri application",
      keywords: ["tray", "system tray", "menu", "icon", "notification area"],
      category: "learn",
    },
    {
      title: "Splashscreen",
      url: "https://v2.tauri.app/learn/splashscreen/",
      description: "Add a splashscreen to your Tauri application",
      keywords: ["splash", "splashscreen", "loading", "startup"],
      category: "learn",
    },
  
    // Configuration reference
    {
      title: "Configuration Reference",
      url: "https://v2.tauri.app/reference/config/",
      description: "Complete reference for Tauri configuration options",
      keywords: ["config", "reference", "options", "settings", "tauri.conf.json"],
      category: "reference",
    },
    {
      title: "CLI Reference",
      url: "https://v2.tauri.app/reference/cli/",
      description: "Command-line interface reference for Tauri",
      keywords: ["cli", "command", "terminal", "tauri-cli", "commands"],
      category: "reference",
    },
    {
      title: "Environment Variables",
      url: "https://v2.tauri.app/reference/environment-variables/",
      description: "Environment variables used by Tauri",
      keywords: ["env", "environment", "variables", "configuration"],
      category: "reference",
    },
  
    // Platform-specific signing
    {
      title: "macOS Code Signing",
      url: "https://v2.tauri.app/distribute/sign/macos/",
      description: "How to sign your Tauri application for macOS",
      keywords: ["sign", "signing", "macos", "apple", "notarize"],
      category: "distribute",
    },
    {
      title: "Windows Code Signing",
      url: "https://v2.tauri.app/distribute/sign/windows/",
      description: "How to sign your Tauri application for Windows",
      keywords: ["sign", "signing", "windows", "certificate"],
      category: "distribute",
    },
    {
      title: "Linux Code Signing",
      url: "https://v2.tauri.app/distribute/sign/linux/",
      description: "How to sign your Tauri application for Linux",
      keywords: ["sign", "signing", "linux", "gpg", "signature"],
      category: "distribute",
    },
  
    // Additional Framework Integrations
    {
      title: "Nuxt Integration",
      url: "https://v2.tauri.app/start/frontend/nuxt/",
      description: "How to use Nuxt with Tauri v2",
      keywords: ["nuxt", "vue", "frontend", "integration"],
      category: "guide",
    },
    {
      title: "Leptos Integration",
      url: "https://v2.tauri.app/start/frontend/leptos/",
      description: "How to use Leptos (Rust framework) with Tauri v2",
      keywords: ["leptos", "rust", "frontend", "integration", "wasm"],
      category: "guide",
    },
    {
      title: "Qwik Integration",
      url: "https://v2.tauri.app/start/frontend/qwik/",
      description: "How to use Qwik with Tauri v2",
      keywords: ["qwik", "frontend", "integration", "resumable"],
      category: "guide",
    },
    {
      title: "Trunk Integration",
      url: "https://v2.tauri.app/start/frontend/trunk/",
      description: "How to use Trunk with Tauri v2 for Rust-based frontends",
      keywords: ["trunk", "rust", "wasm", "frontend", "integration"],
      category: "guide",
    },
    {
      title: "Vite Integration",
      url: "https://v2.tauri.app/start/frontend/vite/",
      description: "How to use Vite with Tauri v2",
      keywords: ["vite", "frontend", "integration", "build tool"],
      category: "guide",
    },
  
    // More Core Concepts
    {
      title: "Size Optimization",
      url: "https://v2.tauri.app/concept/size/",
      description: "Understanding and optimizing the size of Tauri applications",
      keywords: ["size", "optimization", "bundle", "binary", "reduce"],
      category: "concept",
    },
    {
      title: "IPC Isolation",
      url: "https://v2.tauri.app/concept/inter-process-communication/isolation/",
      description: "Security through IPC isolation in Tauri apps",
      keywords: ["ipc", "isolation", "security", "process", "communication"],
      category: "concept",
    },
    {
      title: "Brownfield IPC",
      url: "https://v2.tauri.app/concept/inter-process-communication/brownfield/",
      description: "Integrating Tauri into existing applications",
      keywords: ["brownfield", "existing", "integration", "ipc", "legacy"],
      category: "concept",
    },
  
    // Additional Security Topics
    {
      title: "Content Security Policy",
      url: "https://v2.tauri.app/security/csp/",
      description: "Configure Content Security Policy for your Tauri application",
      keywords: ["csp", "security", "content", "policy", "xss"],
      category: "security",
    },
    {
      title: "HTTP Headers",
      url: "https://v2.tauri.app/security/http-headers/",
      description: "Security-related HTTP headers in Tauri applications",
      keywords: ["http", "headers", "security", "response", "web"],
      category: "security",
    },
    {
      title: "Security Ecosystem",
      url: "https://v2.tauri.app/security/ecosystem/",
      description: "The security ecosystem surrounding Tauri",
      keywords: ["ecosystem", "security", "community", "audits"],
      category: "security",
    },
    {
      title: "Security Lifecycle",
      url: "https://v2.tauri.app/security/lifecycle/",
      description: "Vulnerability management and security lifecycle",
      keywords: [
        "lifecycle",
        "security",
        "vulnerability",
        "management",
        "patching",
      ],
      category: "security",
    },
    {
      title: "Future Security",
      url: "https://v2.tauri.app/security/future/",
      description: "Future security enhancements planned for Tauri",
      keywords: ["future", "roadmap", "security", "plans"],
      category: "security",
    },
    {
      title: "Runtime Authority",
      url: "https://v2.tauri.app/security/runtime-authority/",
      description: "Runtime authority and security model in Tauri",
      keywords: ["runtime", "authority", "security", "model", "permissions"],
      category: "security",
    },
    {
      title: "Security Scopes",
      url: "https://v2.tauri.app/security/scope/",
      description: "Understanding security scopes in Tauri",
      keywords: ["scope", "security", "filesystem", "access", "restrictions"],
      category: "security",
    },
  
    // Additional Development Resources
    {
      title: "Resource Management",
      url: "https://v2.tauri.app/develop/resources/",
      description: "Managing resources in your Tauri application",
      keywords: ["resources", "assets", "files", "bundle", "manage"],
      category: "develop",
    },
    {
      title: "Sidecar Management",
      url: "https://v2.tauri.app/develop/sidecar/",
      description: "Using sidecars for bundling binaries with your Tauri app",
      keywords: ["sidecar", "binary", "executable", "bundle", "external"],
      category: "develop",
    },
    {
      title: "State Management",
      url: "https://v2.tauri.app/develop/state-management/",
      description: "Managing application state in Tauri",
      keywords: ["state", "management", "data", "store", "persistent"],
      category: "develop",
    },
    {
      title: "Updating Dependencies",
      url: "https://v2.tauri.app/develop/updating-dependencies/",
      description: "How to update dependencies in Tauri applications",
      keywords: ["dependencies", "update", "cargo", "npm", "packages"],
      category: "develop",
    },
  
    // Debugging Section
    {
      title: "Debugging Guide",
      url: "https://v2.tauri.app/develop/debug/",
      description: "Debugging techniques for Tauri applications",
      keywords: ["debug", "debugging", "troubleshoot", "dev tools"],
      category: "develop",
    },
    {
      title: "CrabNebula DevTools",
      url: "https://v2.tauri.app/develop/debug/crabnebula-devtools/",
      description: "Using CrabNebula DevTools with Tauri",
      keywords: ["devtools", "crabnebula", "debug", "tools", "inspection"],
      category: "develop",
    },
    {
      title: "VS Code Debugging",
      url: "https://v2.tauri.app/develop/debug/vscode/",
      description: "Debugging Tauri apps in VS Code",
      keywords: ["vscode", "debug", "ide", "editor", "development"],
      category: "develop",
    },
    {
      title: "RustRover Debugging",
      url: "https://v2.tauri.app/develop/debug/rustrover/",
      description: "Debugging Tauri apps in RustRover",
      keywords: ["rustrover", "debug", "ide", "jetbrains", "development"],
      category: "develop",
    },
    {
      title: "Neovim Debugging",
      url: "https://v2.tauri.app/develop/debug/neovim/",
      description: "Debugging Tauri apps in Neovim",
      keywords: ["neovim", "vim", "debug", "editor", "development"],
      category: "develop",
    },
  
    // Additional Distribution Methods
    {
      title: "Flatpak Distribution",
      url: "https://v2.tauri.app/distribute/flatpak/",
      description: "Distributing your Tauri app as a Flatpak package",
      keywords: ["flatpak", "linux", "distribution", "package", "sandbox"],
      category: "distribute",
    },
    {
      title: "Snapcraft Distribution",
      url: "https://v2.tauri.app/distribute/snapcraft/",
      description: "Distributing your Tauri app as a Snap package",
      keywords: ["snap", "snapcraft", "linux", "distribution", "ubuntu"],
      category: "distribute",
    },
    {
      title: "AUR Distribution",
      url: "https://v2.tauri.app/distribute/aur/",
      description: "Publishing your Tauri app to Arch User Repository",
      keywords: ["aur", "arch", "linux", "distribution", "package"],
      category: "distribute",
    },
    {
      title: "Debian Distribution",
      url: "https://v2.tauri.app/distribute/debian/",
      description: "Creating Debian packages for your Tauri app",
      keywords: ["debian", "deb", "linux", "distribution", "package"],
      category: "distribute",
    },
    {
      title: "RPM Distribution",
      url: "https://v2.tauri.app/distribute/rpm/",
      description: "Creating RPM packages for your Tauri app",
      keywords: ["rpm", "fedora", "redhat", "linux", "distribution"],
      category: "distribute",
    },
    {
      title: "CrabNebula Cloud",
      url: "https://v2.tauri.app/distribute/crabnebula-cloud/",
      description: "Using CrabNebula Cloud for Tauri app distribution",
      keywords: ["cloud", "distribution", "crabnebula", "deployment", "hosting"],
      category: "distribute",
    },
  
    // CI/CD Pipelines
    {
      title: "GitHub CI/CD",
      url: "https://v2.tauri.app/distribute/pipelines/github/",
      description: "Setting up CI/CD for Tauri apps with GitHub Actions",
      keywords: ["github", "ci", "cd", "actions", "pipeline", "automation"],
      category: "distribute",
    },
    {
      title: "CrabNebula Cloud CI/CD",
      url: "https://v2.tauri.app/distribute/pipelines/crabnebula-cloud/",
      description: "Setting up CI/CD with CrabNebula Cloud",
      keywords: ["crabnebula", "cloud", "ci", "cd", "pipeline", "automation"],
      category: "distribute",
    },
  
    // More Plugins
    {
      title: "Biometric Plugin",
      url: "https://v2.tauri.app/plugin/biometric/",
      description: "Biometric authentication in Tauri applications",
      keywords: ["biometric", "auth", "fingerprint", "face", "security"],
      category: "plugin",
    },
    {
      title: "Barcode Scanner",
      url: "https://v2.tauri.app/plugin/barcode-scanner/",
      description: "Scan barcodes and QR codes in Tauri applications",
      keywords: ["barcode", "qr", "scanner", "scan", "code"],
      category: "plugin",
    },
    {
      title: "Deep Linking",
      url: "https://v2.tauri.app/plugin/deep-linking/",
      description: "Configure deep links for your Tauri application",
      keywords: ["deep", "link", "url", "protocol", "handler"],
      category: "plugin",
    },
    {
      title: "SQL Plugin",
      url: "https://v2.tauri.app/plugin/sql/",
      description: "SQL database support in Tauri applications",
      keywords: ["sql", "database", "db", "sqlite", "query"],
      category: "plugin",
    },
    {
      title: "WebSocket Plugin",
      url: "https://v2.tauri.app/plugin/websocket/",
      description: "WebSocket support in Tauri applications",
      keywords: ["websocket", "ws", "socket", "real-time", "network"],
      category: "plugin",
    },
    {
      title: "Window State Plugin",
      url: "https://v2.tauri.app/plugin/window-state/",
      description: "Save and restore window state in Tauri",
      keywords: ["window", "state", "position", "size", "save"],
      category: "plugin",
    },
  
    // About section
    {
      title: "Tauri Philosophy",
      url: "https://v2.tauri.app/about/philosophy/",
      description: "The philosophy and guiding principles behind Tauri",
      keywords: ["philosophy", "principles", "vision", "mission", "about"],
      category: "about",
    },
    {
      title: "Governance",
      url: "https://v2.tauri.app/about/governance/",
      description: "How the Tauri project is governed",
      keywords: ["governance", "team", "organization", "structure"],
      category: "about",
    },
    {
      title: "Tauri Book",
      url: "https://v2.tauri.app/about/book/",
      description: "The Tauri book - comprehensive documentation",
      keywords: ["book", "documentation", "guide", "reference", "manual"],
      category: "about",
    },
  
    // Special content for mobile development
    {
      title: "Android Signing",
      url: "https://v2.tauri.app/distribute/sign/android/",
      description: "Signing your Tauri app for Android distribution",
      keywords: ["android", "signing", "mobile", "apk", "aab"],
      category: "mobile",
    },
    {
      title: "iOS Signing",
      url: "https://v2.tauri.app/distribute/sign/ios/",
      description: "Signing your Tauri app for iOS distribution",
      keywords: ["ios", "signing", "mobile", "certificate", "provisioning"],
      category: "mobile",
    },
  
    // ACL references
    {
      title: "Capabilities Reference",
      url: "https://v2.tauri.app/reference/acl/capability/",
      description: "Reference for capabilities in Tauri's permission system",
      keywords: ["capability", "acl", "permissions", "security", "reference"],
      category: "reference",
    },
    {
      title: "Permissions Reference",
      url: "https://v2.tauri.app/reference/acl/permission/",
      description: "Reference for permissions in Tauri's security system",
      keywords: ["permission", "acl", "security", "reference", "allow"],
      category: "reference",
    },
    {
      title: "Scopes Reference",
      url: "https://v2.tauri.app/reference/acl/scope/",
      description: "Reference for scopes in Tauri's security system",
      keywords: ["scope", "acl", "security", "filesystem", "reference"],
      category: "reference",
    },
    {
      title: "Core Permissions",
      url: "https://v2.tauri.app/reference/acl/core-permissions/",
      description: "Documentation of core permissions in Tauri",
      keywords: ["core", "permissions", "acl", "reference", "security"],
      category: "reference",
    },
    {
      title: "WebView Versions",
      url: "https://v2.tauri.app/reference/webview-versions/",
      description: "WebView versions used by Tauri on different platforms",
      keywords: ["webview", "browser", "version", "webkit", "edge", "webview2"],
      category: "reference",
    },
  
    // Learn section special content
    {
      title: "NodeJS Sidecar",
      url: "https://v2.tauri.app/learn/sidecar-nodejs/",
      description: "Using Node.js as a sidecar in your Tauri application",
      keywords: ["nodejs", "node", "sidecar", "javascript", "integration"],
      category: "learn",
    },
    {
      title: "Window Menu",
      url: "https://v2.tauri.app/learn/window-menu/",
      description: "Implement and customize window menus in Tauri",
      keywords: ["menu", "window", "menubar", "dropdown", "context"],
      category: "learn",
    },
    {
      title: "Plugin Permissions Usage",
      url: "https://v2.tauri.app/learn/security/using-plugin-permissions/",
      description: "How to properly use plugin permissions in Tauri",
      keywords: ["plugin", "permissions", "security", "usage", "allow"],
      category: "learn",
    },
    {
      title: "Capabilities for Windows",
      url: "https://v2.tauri.app/learn/security/capabilities-for-windows-and-platforms/",
      description: "Setting up capabilities for windows and platforms",
      keywords: [
        "capabilities",
        "windows",
        "platforms",
        "security",
        "permissions",
      ],
      category: "learn",
    },
    {
      title: "Writing Plugin Permissions",
      url: "https://v2.tauri.app/learn/security/writing-plugin-permissions/",
      description: "How to write permissions for your custom plugins",
      keywords: ["plugin", "permissions", "security", "custom", "development"],
      category: "learn",
    },
  
    // Missing Plugins
    {
      title: "Autostart Plugin",
      url: "https://v2.tauri.app/plugin/autostart/",
      description:
        "Configure your Tauri app to start automatically on system boot",
      keywords: ["autostart", "startup", "boot", "launch", "automatic"],
      category: "plugin",
    },
    {
      title: "Single Instance Plugin",
      url: "https://v2.tauri.app/plugin/single-instance/",
      description: "Ensure only one instance of your Tauri app is running",
      keywords: ["single", "instance", "unique", "multiple", "prevent"],
      category: "plugin",
    },
    {
      title: "CLI Plugin",
      url: "https://v2.tauri.app/plugin/cli/",
      description: "Add command-line interface to your Tauri application",
      keywords: ["cli", "command-line", "terminal", "args", "arguments"],
      category: "plugin",
    },
    {
      title: "Localhost Plugin",
      url: "https://v2.tauri.app/plugin/localhost/",
      description: "Create a local web server in your Tauri application",
      keywords: ["localhost", "server", "http", "web", "serve"],
      category: "plugin",
    },
    {
      title: "Logging Plugin",
      url: "https://v2.tauri.app/plugin/logging/",
      description: "Advanced logging capabilities for Tauri applications",
      keywords: ["logging", "log", "debug", "tracing", "diagnostics"],
      category: "plugin",
    },
    {
      title: "NFC Plugin",
      url: "https://v2.tauri.app/plugin/nfc/",
      description: "Access NFC functionality in your Tauri application",
      keywords: ["nfc", "near field", "communication", "mobile", "tag"],
      category: "plugin",
    },
    {
      title: "Persisted Scope Plugin",
      url: "https://v2.tauri.app/plugin/persisted-scope/",
      description: "Persistent file system access in Tauri applications",
      keywords: ["persisted", "scope", "filesystem", "access", "permanent"],
      category: "plugin",
    },
    {
      title: "Positioner Plugin",
      url: "https://v2.tauri.app/plugin/positioner/",
      description: "Position windows relative to the screen or other windows",
      keywords: ["position", "window", "placement", "location", "screen"],
      category: "plugin",
    },
    {
      title: "Process Plugin",
      url: "https://v2.tauri.app/plugin/process/",
      description: "Execute and manage system processes in Tauri applications",
      keywords: ["process", "execute", "command", "spawn", "terminal"],
      category: "plugin",
    },
    {
      title: "Stronghold Plugin",
      url: "https://v2.tauri.app/plugin/stronghold/",
      description: "Secure storage for sensitive data in Tauri applications",
      keywords: ["stronghold", "secure", "encryption", "storage", "sensitive"],
      category: "plugin",
    },
    {
      title: "Upload Plugin",
      url: "https://v2.tauri.app/plugin/upload/",
      description: "Handle file uploads in Tauri applications",
      keywords: ["upload", "file", "http", "form", "multipart"],
      category: "plugin",
    },
  
    // Additional distribution methods
    {
      title: "macOS Application Bundle",
      url: "https://v2.tauri.app/distribute/macos-application-bundle/",
      description: "Create macOS application bundles with Tauri",
      keywords: ["macos", "application", "bundle", "packaging", "app"],
      category: "distribute",
    },
    {
      title: "Microsoft Store",
      url: "https://v2.tauri.app/distribute/microsoft-store/",
      description: "Publish your Tauri app on the Microsoft Store",
      keywords: ["microsoft", "store", "windows", "distribute", "publish"],
      category: "distribute",
    },
  
    // Main sections
    {
      title: "Tauri Concepts",
      url: "https://v2.tauri.app/concept/",
      description: "Core concepts behind Tauri's design and architecture",
      keywords: ["concepts", "architecture", "design", "overview", "principles"],
      category: "concept",
    },
    {
      title: "Development Guide",
      url: "https://v2.tauri.app/develop/",
      description: "Comprehensive guide to developing Tauri applications",
      keywords: ["develop", "guide", "create", "build", "code"],
      category: "develop",
    },
    {
      title: "Learn Tauri",
      url: "https://v2.tauri.app/learn/",
      description: "Learning resources and tutorials for Tauri",
      keywords: ["learn", "tutorial", "guide", "howto", "examples"],
      category: "learn",
    },
    {
      title: "Tauri Plugins",
      url: "https://v2.tauri.app/plugin/",
      description: "Overview of all available plugins for Tauri",
      keywords: ["plugins", "extensions", "addons", "ecosystem", "library"],
      category: "plugin",
    },
    {
      title: "About Tauri",
      url: "https://v2.tauri.app/about/",
      description: "Information about the Tauri project, team, and philosophy",
      keywords: ["about", "project", "team", "info", "background"],
      category: "about",
    },
    {
      title: "Migration Guide",
      url: "https://v2.tauri.app/start/migrate/",
      description: "Guide for migrating between Tauri versions",
      keywords: ["migrate", "migration", "upgrade", "update", "convert"],
      category: "guide",
    },
    {
      title: "Tauri Trademark",
      url: "https://v2.tauri.app/about/trademark/",
      description: "Tauri trademark usage guidelines and policies",
      keywords: ["trademark", "brand", "logo", "legal", "guidelines"],
      category: "about",
    },
  
    // Test mocking
    {
      title: "Mocking in Tests",
      url: "https://v2.tauri.app/develop/tests/mocking/",
      description: "How to mock Tauri functionality in tests",
      keywords: ["mock", "mocking", "test", "unit test", "integration"],
      category: "develop",
    },
    {
      title: "WebDriver CI Setup",
      url: "https://v2.tauri.app/develop/tests/webdriver/ci/",
      description: "Setting up WebDriver tests in CI pipelines",
      keywords: ["webdriver", "ci", "continuous", "integration", "automation"],
      category: "develop",
    },
    {
      title: "WebDriver Examples",
      url: "https://v2.tauri.app/develop/tests/webdriver/example/",
      description: "Example WebDriver tests for Tauri applications",
      keywords: ["webdriver", "example", "test", "e2e", "selenium"],
      category: "develop",
    },
    {
      title: "Selenium WebDriver Example",
      url: "https://v2.tauri.app/develop/tests/webdriver/example/selenium/",
      description: "Using Selenium WebDriver with Tauri applications",
      keywords: ["selenium", "webdriver", "test", "example", "e2e"],
      category: "develop",
    },
    {
      title: "WebdriverIO Example",
      url: "https://v2.tauri.app/develop/tests/webdriver/example/webdriverio/",
      description: "Using WebdriverIO with Tauri applications",
      keywords: ["webdriverio", "webdriver", "test", "example", "e2e"],
      category: "develop",
    },
];
