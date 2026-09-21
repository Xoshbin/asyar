### `OnboardingService` — Extension First-Run Onboarding Completion

**Runs in:** both worker and view.

**Permission required:** None (implicit; host security injects calling extension ID).

`OnboardingService` allows extensions that define a first-run onboarding experience to notify the launcher when setup is finished. Calling `complete()` marks the extension as onboarded, dismisses the onboarding screen, and automatically re-dispatches whichever command the user originally tried to run.

```typescript
export interface IOnboardingService {
  /**
   * Signals to the launcher that this extension's onboarding flow has completed.
   *
   * The launcher marks the extension as onboarded and re-dispatches whichever
   * command the user originally tried to run that triggered onboarding.
   * Idempotent — calling on an already-onboarded extension is a safe no-op.
   */
  complete(): Promise<void>;
}
```

#### Usage

```typescript
import type { IOnboardingService } from 'asyar-sdk/contracts';

// Resolve from ExtensionContext
const onboarding = context.getService<IOnboardingService>('onboarding');

// When user finishes initial setup (e.g. API key saved, permissions granted)
async function finishSetup() {
  await saveConfig();
  await onboarding.complete();
}
```

#### How it works under the hood

1. **Triggering:** If an extension declares an onboarding view or configuration requirements that are incomplete, the host intercepts command invocations and presents the onboarding view first.
2. **Idempotence:** `complete()` is idempotent. If invoked again after an extension is already onboarded, the host acknowledges the call without error.
3. **Command Re-dispatch:** If the user pressed a shortcut or clicked a specific extension command from the search bar, the launcher tracks the pending command ID and automatically executes it once `onboarding.complete()` resolves.
4. **Security:** The IPC router derives the extension identity directly from the calling sandbox container (`extensionId`), preventing extensions from altering the onboarding status of other extensions.
