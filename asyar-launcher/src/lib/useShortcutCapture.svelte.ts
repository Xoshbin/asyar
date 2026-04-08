import { invoke } from '@tauri-apps/api/core';
import {
  MODIFIER_KEYS,
  MODIFIER_ORDER,
  MODIFIER_SYMBOL,
  CODE_TO_KEY,
  KEY_DISPLAY,
  DOM_TO_MODIFIER,
  VALID_KEYS,
} from '../built-in-features/shortcuts/shortcutFormatter';

export interface CaptureConfig {
  conflictChecker?: (shortcut: string) => Promise<{ name: string } | null>;
  onCapture: (result: { modifier: string; key: string }) => Promise<string | true>;
  onCancel?: () => void;
  onDone?: () => void;
}

export interface CaptureState {
  isRecording: boolean;
  saveState: 'idle' | 'saving' | 'success' | 'error';
  errorMessage: string;
  errorType: 'no-modifier' | 'invalid-key' | 'conflict' | 'generic' | '';
  partialModifiers: string[];
  rejectedKeys: string[];
  invalidKeys: Set<string>;
  rejectedKeysHeld: Set<string>;
  failedChips: string[];
  conflictInfo: string | null;
}

function modifierSymbol(mod: string): string {
  return MODIFIER_SYMBOL[mod] ?? mod;
}

function displayKey(k: string): string {
  return KEY_DISPLAY[k] ?? k;
}

export function useShortcutCapture(config: CaptureConfig) {
  let isRecording = $state(false);
  let saveState = $state<CaptureState['saveState']>('idle');
  let errorMessage = $state('');
  let errorType = $state<CaptureState['errorType']>('');
  let rejectedKeys = $state<string[]>([]);
  let invalidKeys = $state<Set<string>>(new Set());
  let partialModifiers = $state<string[]>([]);
  let rejectedKeysHeld = $state<Set<string>>(new Set());
  let failedChips = $state<string[]>([]);
  let conflictInfo = $state<string | null>(null);
  let rejectedTimer: ReturnType<typeof setTimeout> | null = null;
  let savedWithoutCancel = false;

  let savedModifier = $state('');
  let savedKey = $state('');

  function clearRejectedTimer() {
    if (rejectedTimer) {
      clearTimeout(rejectedTimer);
      rejectedTimer = null;
    }
  }

  function resetRejectedState() {
    rejectedKeys = [];
    invalidKeys = new Set();
    rejectedKeysHeld = new Set();
    errorType = '';
    errorMessage = '';
    conflictInfo = null;
  }

  function startRejectedTimeout() {
    clearRejectedTimer();
    rejectedTimer = setTimeout(() => resetRejectedState(), 3000);
  }

  async function attemptSave(capturedModifier: string, capturedKey: string) {
    if (config.conflictChecker) {
      const shortcutString = `${capturedModifier}+${capturedKey}`;
      const conflict = await config.conflictChecker(shortcutString);
      if (conflict) {
        errorType = 'conflict';
        conflictInfo = conflict.name;
        failedChips = [
          ...capturedModifier.split('+').map(m => modifierSymbol(m)),
          displayKey(capturedKey),
        ];
        startRejectedTimeout();
        return;
      }
    }

    savedWithoutCancel = true;
    stopRecording();

    saveState = 'saving';
    savedModifier = capturedModifier;
    savedKey = capturedKey;

    const result = await config.onCapture({ modifier: capturedModifier, key: capturedKey });
    if (result === true) {
      saveState = 'success';
      setTimeout(() => {
        saveState = 'idle'; errorType = ''; errorMessage = ''; failedChips = [];
        config.onDone?.();
      }, 1500);
    } else {
      saveState = 'error';
      errorType = 'generic';
      failedChips = [
        ...capturedModifier.split('+').map(m => modifierSymbol(m)),
        displayKey(capturedKey),
      ];
      errorMessage = result || 'Failed to save shortcut';
      savedModifier = '';
      savedKey = '';
      setTimeout(() => { saveState = 'idle'; errorType = ''; errorMessage = ''; failedChips = []; }, 3000);
    }
  }

  function handleWindowBlur() {
    stopRecording();
  }

  function removeListeners() {
    window.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('keyup', handleKeyUp, true);
    window.removeEventListener('blur', handleWindowBlur);
    invoke('resume_all_shortcuts').catch(console.error);
  }

  function stopRecording() {
    const wasRecording = isRecording;
    isRecording = false;
    partialModifiers = [];
    resetRejectedState();
    clearRejectedTimer();

    if (wasRecording) {
      removeListeners();
      if (!savedWithoutCancel) {
        config.onCancel?.();
      }
    }
    savedWithoutCancel = false;
  }

  function startRecording() {
    if (saveState === 'saving') return;
    isRecording = true;
    saveState = 'idle';
    errorMessage = '';
    partialModifiers = [];
    savedWithoutCancel = false;

    invoke('pause_all_shortcuts').catch(console.error);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleWindowBlur);
  }

  function handleKeyDown(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stopRecording();
      return;
    }

    if (MODIFIER_KEYS.includes(event.key)) {
      if (!partialModifiers.includes(event.key)) {
        partialModifiers = [...partialModifiers, event.key];
      }

      // Bare key held + modifier added → complete the shortcut
      if (
        rejectedKeys.length === 1 &&
        rejectedKeysHeld.has(rejectedKeys[0]) &&
        errorType === 'no-modifier' &&
        partialModifiers.length >= 1
      ) {
        clearRejectedTimer();
        const capturedModifier = partialModifiers.map(m => DOM_TO_MODIFIER[m] ?? m).join('+');
        const capturedKey = rejectedKeys[0];

        rejectedKeys = [];
        errorType = '';
        errorMessage = '';

        attemptSave(capturedModifier, capturedKey);
      }
      return;
    }

    // Use event.code for physical key (unaffected by Shift)
    let capturedKey = CODE_TO_KEY[event.code] ?? null;
    if (!capturedKey) {
      capturedKey = event.key;
      if (capturedKey === ' ' || capturedKey === 'Spacebar') capturedKey = 'Space';
      else if (capturedKey.length === 1) capturedKey = capturedKey.toUpperCase();
    }

    if (!VALID_KEYS.has(capturedKey)) {
      if (!rejectedKeys.includes(capturedKey)) {
        rejectedKeys = [...rejectedKeys, capturedKey];
      }
      invalidKeys = new Set([...invalidKeys, capturedKey]);
      rejectedKeysHeld = new Set([...rejectedKeysHeld, capturedKey]);
      errorType = 'invalid-key';
      errorMessage = 'invalid-key';
      startRejectedTimeout();
      return;
    }

    const modifierParts: string[] = [];
    if (event.ctrlKey) modifierParts.push('Control');
    if (event.altKey) modifierParts.push('Alt');
    if (event.shiftKey) modifierParts.push('Shift');
    if (event.metaKey) modifierParts.push('Super');

    const hasStrongModifier = event.ctrlKey || event.altKey || event.metaKey;
    if (modifierParts.length === 0 || !hasStrongModifier) {
      if (!rejectedKeys.includes(capturedKey)) {
        rejectedKeys = [...rejectedKeys, capturedKey];
      }
      rejectedKeysHeld = new Set([...rejectedKeysHeld, capturedKey]);
      if (errorType !== 'invalid-key') {
        errorType = 'no-modifier';
        errorMessage = 'no-modifier';
      }
      startRejectedTimeout();
      return;
    }

    if (invalidKeys.size > 0) {
      clearRejectedTimer();
      if (!rejectedKeys.includes(capturedKey)) {
        rejectedKeys = [...rejectedKeys, capturedKey];
      }
      rejectedKeysHeld = new Set([...rejectedKeysHeld, capturedKey]);
      startRejectedTimeout();
      return;
    }

    attemptSave(modifierParts.join('+'), capturedKey);
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (MODIFIER_KEYS.includes(event.key)) {
      partialModifiers = partialModifiers.filter(m => m !== event.key);
    } else if (rejectedKeys.length > 0) {
      const releasedKey = CODE_TO_KEY[event.code] ?? event.key;
      if (rejectedKeysHeld.has(releasedKey)) {
        const newHeld = new Set(rejectedKeysHeld);
        newHeld.delete(releasedKey);
        rejectedKeysHeld = newHeld;

        rejectedKeys = rejectedKeys.filter(k => k !== releasedKey);
        const newInvalid = new Set(invalidKeys);
        newInvalid.delete(releasedKey);
        invalidKeys = newInvalid;

        if (invalidKeys.size === 0) {
          const validHeld = rejectedKeys.filter(k => VALID_KEYS.has(k));
          if (validHeld.length === 1 && partialModifiers.length >= 1) {
            clearRejectedTimer();
            const capturedModifier = [...partialModifiers]
              .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
              .map(m => DOM_TO_MODIFIER[m] ?? m)
              .join('+');

            rejectedKeys = [];
            errorType = '';
            errorMessage = '';

            attemptSave(capturedModifier, validHeld[0]);
            return;
          }

          if (errorType === 'invalid-key') {
            errorType = rejectedKeys.length > 0 ? 'no-modifier' : '';
            errorMessage = rejectedKeys.length > 0 ? 'no-modifier' : '';
          }
        }

        if (rejectedKeys.length === 0) {
          clearRejectedTimer();
          invalidKeys = new Set();
          errorType = '';
          errorMessage = '';
        }
      }
    }
  }

  let partialChips = $derived.by(() => {
    return [...partialModifiers]
      .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
      .map(m => modifierSymbol(DOM_TO_MODIFIER[m] ?? m));
  });

  let rejectedModifierChips = $derived(
    partialModifiers.map(m => modifierSymbol(DOM_TO_MODIFIER[m] ?? m))
  );

  let hasValidRejectedKeys = $derived(rejectedKeys.some(k => !invalidKeys.has(k)));

  let displayChips = $derived.by(() => {
    const mod = savedModifier || '';
    const k = savedKey || '';
    if (mod && k) {
      const mods = mod.split('+')
        .sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b))
        .map(m => modifierSymbol(m));
      return [...mods, displayKey(k)];
    }
    return [];
  });

  return {
    get state(): CaptureState {
      return {
        isRecording,
        saveState,
        errorMessage,
        errorType,
        partialModifiers,
        rejectedKeys,
        invalidKeys,
        rejectedKeysHeld,
        failedChips,
        conflictInfo,
      };
    },
    get partialChips() { return partialChips; },
    get rejectedModifierChips() { return rejectedModifierChips; },
    get hasValidRejectedKeys() { return hasValidRejectedKeys; },
    get displayChips() { return displayChips; },
    get savedModifier() { return savedModifier; },
    get savedKey() { return savedKey; },
    displayKey,
    modifierSymbol,
    startRecording,
    stopRecording,
  };
}
