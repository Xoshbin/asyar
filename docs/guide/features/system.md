# System Commands

> Control your computer with quick commands: Sleep, Lock Screen, Restart, Shut Down, and Log Out.

## What it does

Asyar includes built-in commands for core operating system power and session controls. Rather than navigating nested OS menus, you can lock your screen, trigger sleep, sign out, reboot, or shut down directly from the search bar or via global hotkeys.

Destructive commands (Restart, Shut Down, and Log Out / Sign Out) prompt for confirmation before proceeding, preventing accidental reboots or unsaved data loss.

## Available commands

| Command                | What it does                                                      | Confirmation prompt |
| ---------------------- | ----------------------------------------------------------------- | ------------------- |
| **Lock Screen**        | Instantly locks the display and requires authentication.          | No                  |
| **Sleep**              | Puts the computer into low-power sleep mode.                      | No                  |
| **Hibernate**          | Saves the system state to disk and powers down (where supported). | No                  |
| **Restart**            | Reboots the operating system.                                     | Yes                 |
| **Shut Down**          | Powers off the computer.                                          | Yes                 |
| **Log Out / Sign Out** | Ends the current user session (labeled "Sign Out" on Windows).    | Yes                 |

> Note: Which commands appear depends on your machine and operating system capabilities. For example, **Hibernate** only appears if your OS has hibernation enabled.

## How to use it

1. Open Asyar with your global hotkey.
2. Type the action you want — for example, `lock`, `sleep`, `restart`, `shut down`, or `log out`.
3. Press `Enter` on the matching result.
4. For actions that require confirmation (Restart, Shut Down, Log Out), a confirmation dialog appears. Press `Enter` to proceed, or `Esc` to cancel.

## Shortcuts & hotkeys

Assigning dedicated hotkeys to system commands provides instant power actions without touching the mouse:

1. Open **Settings → Extensions** (`⌘,`).
2. Locate the **System** feature in the list and click the chevron to expand its commands.
3. Click **Record Hotkey** next to the command you want to bind (for example, **Lock Screen**).
4. Enter your preferred combination (e.g. `⌃⌥⌘L` or a single function key like `F19`) and click **Save**.

## Platform differences

- **macOS**: Lock Screen uses `SACLockScreenImmediate`, Sleep uses `IOPMSleepSystem`, and Restart/Shutdown interact cleanly with macOS session management.
- **Windows**: Lock Screen calls `LockWorkStation`, Log Out is labeled **Sign Out** to match Windows terminology, and Hibernate is supported when enabled in Windows power settings.
- **Linux**: Commands interface with systemd `logind` or desktop manager DBus interfaces (`org.freedesktop.login1` / `org.freedesktop.ScreenSaver`).

## Tips

- **Quick lock hotkey**: Many external keyboards lack a dedicated lock button. Binding `Lock Screen` to a function key (like `F12` or `F16`) turns any key into an instant privacy lock.
- **Confirmation bypass safety**: To prevent accidental activations from fuzzy search typos, critical actions cannot be run without confirmation.

## Related

- [The Basics](../the-basics.md)
- [Aliases & Shortcuts](./aliases-and-shortcuts.md)
- [Settings](../settings.md)
