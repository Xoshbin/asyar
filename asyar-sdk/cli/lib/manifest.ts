import * as fs from 'node:fs'
import * as path from 'node:path'
import * as semver from 'semver'

export type CommandMode = 'view' | 'background'

export interface AsyarManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  permissions?: string[]
  commands: ManifestCommand[]
  minAppVersion?: string
  asyarSdk?: string
  platforms?: string[]
  type?: 'theme' | 'extension'
  searchable?: boolean
  preferences?: PreferenceDeclaration[]
  /**
   * Tier 2 extensions that need an always-on headless worker (any command
   * with `mode: "background"`, or a searchable extension whose `search()`
   * runs headlessly) declare it via `background.main`. Points at the built
   * worker bundle, typically `dist/worker.js`. Presence gates the CLI's
   * build-output validator to additionally require `dist/worker.html`.
   */
  background?: {
    main: string
  }
}

export type PreferenceType =
  | 'textfield'
  | 'password'
  | 'number'
  | 'checkbox'
  | 'dropdown'
  | 'appPicker'
  | 'file'
  | 'directory';

export interface DropdownOption {
  value: string;
  title: string;
}

export interface PreferenceDeclaration {
  name: string;
  type: PreferenceType;
  title: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  data?: DropdownOption[];
}

const VALID_PREFERENCE_TYPES: PreferenceType[] = [
  'textfield',
  'password',
  'number',
  'checkbox',
  'dropdown',
  'appPicker',
  'file',
  'directory',
];
const PREF_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export type CommandArgumentType = 'text' | 'password' | 'dropdown' | 'number';

export interface CommandArgumentDropdownOption {
  value: string;
  title: string;
}

export interface CommandArgument {
  name: string;
  type: CommandArgumentType;
  placeholder?: string;
  required?: boolean;
  default?: string | number;
  data?: CommandArgumentDropdownOption[];
}

const VALID_ARGUMENT_TYPES: CommandArgumentType[] = ['text', 'password', 'dropdown', 'number'];
const ARG_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MAX_ARGUMENTS_PER_COMMAND = 3;

const VALID_COMMAND_MODES: CommandMode[] = ['view', 'background'];

export interface ManifestCommand {
  id: string
  name: string
  description: string
  mode: CommandMode
  /** Svelte component entry for mode="view" commands. Required when mode is "view". */
  component?: string
  icon?: string
  trigger?: string
  schedule?: {
    intervalSeconds: number;
  };
  preferences?: PreferenceDeclaration[];
  arguments?: CommandArgument[];
}

export interface ValidationError {
  field: string
  message: string
}

export const VALID_PERMISSIONS = [
  'clipboard:read', 'clipboard:write',
  'store:read', 'store:write',
  'notifications:send',
  'fs:read', 'fs:write',
  'shell:spawn',
  'shell:open-url',
  'network',
  'selection:read',
  'storage:read', 'storage:write',
  'ai:use',
  'oauth:use',
  'extension:invoke',
  'cache:read', 'cache:write',
  'window:manage',
  'application:read',
  'entitlements:read',
  'power:inhibit',
  'systemEvents:read',
  'app:frontmost-watch',
  'timers:schedule', 'timers:cancel', 'timers:list',
] as const

export const VALID_PLATFORMS = ['macos', 'windows', 'linux'] as const

export function readManifest(cwd: string): AsyarManifest {
  const manifestPath = path.join(cwd, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${cwd}`)
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch {
    throw new Error('manifest.json is not valid JSON')
  }
}

export function validateManifest(
  manifest: AsyarManifest,
  cwd: string
): ValidationError[] {
  const errors: ValidationError[] = []
  const asUnknown = manifest as unknown as Record<string, unknown>

  if (!manifest.id) {
    errors.push({ field: 'id', message: 'required' })
  } else if (!/^[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*)+$/.test(manifest.id)) {
    errors.push({
      field: 'id',
      message: 'must be dot-notation format: com.author.extensionname',
    })
  }

  if (!manifest.name) {
    errors.push({ field: 'name', message: 'required' })
  } else if (manifest.name.length < 2 || manifest.name.length > 50) {
    errors.push({ field: 'name', message: 'must be between 2 and 50 characters' })
  }

  if (!manifest.version) {
    errors.push({ field: 'version', message: 'required' })
  } else if (!semver.valid(manifest.version)) {
    errors.push({ field: 'version', message: 'must be valid semver (e.g., 1.0.0)' })
  }

  if (!manifest.description) {
    errors.push({ field: 'description', message: 'required' })
  } else if (manifest.description.length < 10 || manifest.description.length > 200) {
    errors.push({
      field: 'description',
      message: 'must be between 10 and 200 characters',
    })
  }

  if (!manifest.author) {
    errors.push({ field: 'author', message: 'required' })
  }

  if (manifest.permissions) {
    manifest.permissions.forEach((perm) => {
      if (!VALID_PERMISSIONS.includes(perm as typeof VALID_PERMISSIONS[number])) {
        const suggestion = VALID_PERMISSIONS.find((v) =>
          v.includes(perm.split(':')[0])
        )
        errors.push({
          field: 'permissions',
          message: `"${perm}" is not a valid permission${
            suggestion ? `. Did you mean "${suggestion}"?` : ''
          }`,
        })
      }
    })
  }

  // Legacy schema rejection — the pre-Phase-1 fields are defunct. Surface a
  // clear error so authors upgrading from an older template get a pointer
  // instead of a silent pass-through.
  if (manifest.type !== undefined && manifest.type !== 'theme' && manifest.type !== 'extension') {
    errors.push({
      field: 'type',
      message: `legacy value "${String(manifest.type)}"; must be "extension" or "theme"`,
    })
  }
  if (asUnknown.defaultView !== undefined) {
    errors.push({
      field: 'defaultView',
      message: 'legacy field; remove and declare per-command "component" instead',
    })
  }
  if (asUnknown.main !== undefined) {
    errors.push({
      field: 'main',
      message: 'legacy field; declare headless workers via "background.main"',
    })
  }

  if (manifest.type === 'theme') {
    if (!fs.existsSync(path.join(cwd, 'theme.json'))) {
      errors.push({ field: 'theme.json', message: 'required for theme extensions' })
    }
  } else {
    if (!manifest.commands || manifest.commands.length === 0) {
      errors.push({ field: 'commands', message: 'at least one command is required' })
    } else {
      manifest.commands.forEach((cmd, i) => validateCommand(cmd, i, errors))
    }

    const hasBackgroundCommand = (manifest.commands ?? []).some((c) => c.mode === 'background')
    const hasViewCommand = (manifest.commands ?? []).some((c) => c.mode === 'view')
    const declaresBackground = !!manifest.background?.main

    if ((hasBackgroundCommand || manifest.searchable === true) && !declaresBackground) {
      errors.push({
        field: 'background.main',
        message: hasBackgroundCommand
          ? 'required when any command has mode="background"'
          : 'required when manifest declares searchable: true (search() runs in the headless worker)',
      })
    }

    if (hasViewCommand) {
      if (!fs.existsSync(path.join(cwd, 'view.html'))) {
        errors.push({
          field: 'view.html',
          message: 'not found in project root (required for commands with mode="view")',
        })
      }
    }

    if (declaresBackground) {
      if (!fs.existsSync(path.join(cwd, 'worker.html'))) {
        errors.push({
          field: 'worker.html',
          message: 'not found in project root (required when background.main is declared)',
        })
      }
    }

    if (hasViewCommand || declaresBackground) {
      const hasViteConfig =
        fs.existsSync(path.join(cwd, 'vite.config.ts')) ||
        fs.existsSync(path.join(cwd, 'vite.config.js'))
      if (!hasViteConfig) {
        errors.push({
          field: 'vite.config',
          message: 'vite.config.ts or vite.config.js not found',
        })
      }
    }
  }

  if (manifest.asyarSdk !== undefined) {
    if (typeof manifest.asyarSdk !== 'string' || !semver.validRange(manifest.asyarSdk)) {
      errors.push({
        field: 'asyarSdk',
        message: `must be a valid semver range (e.g., "^1.2.0"), got: ${manifest.asyarSdk}`,
      })
    }
  }

  if (manifest.minAppVersion !== undefined) {
    if (typeof manifest.minAppVersion !== 'string' || !semver.valid(manifest.minAppVersion)) {
      errors.push({
        field: 'minAppVersion',
        message: `must be a valid semver version (e.g., "0.1.0"), got: ${manifest.minAppVersion}`,
      })
    }
  }

  if (manifest.platforms !== undefined) {
    if (!Array.isArray(manifest.platforms)) {
      errors.push({ field: 'platforms', message: 'must be an array' })
    } else {
      manifest.platforms.forEach((p) => {
        if (!VALID_PLATFORMS.includes(p as typeof VALID_PLATFORMS[number])) {
          errors.push({
            field: 'platforms',
            message: `"${p}" is not a valid platform. Valid values: ${VALID_PLATFORMS.join(', ')}`,
          })
        }
      })
    }
  }

  if (!manifest.asyarSdk && manifest.type !== 'theme') {
    console.warn(
      '⚠️  Consider adding "asyarSdk" to your manifest.json to declare SDK compatibility (e.g., "^1.2.0")'
    )
  }

  errors.push(...validatePreferences(manifest.preferences, 'preferences'));
  (manifest.commands ?? []).forEach((cmd, i) => {
    errors.push(...validatePreferences(cmd.preferences, `commands[${i}].preferences`));
    errors.push(...validateArguments(cmd.arguments, `commands[${i}].arguments`));
  });

  return errors
}

function validateCommand(cmd: ManifestCommand, i: number, errors: ValidationError[]): void {
  const cmdRaw = cmd as unknown as Record<string, unknown>
  const base = `commands[${i}]`

  if (!cmd.id) errors.push({ field: `${base}.id`, message: 'required' })
  if (!cmd.name) errors.push({ field: `${base}.name`, message: 'required' })

  if (cmdRaw.resultType !== undefined) {
    errors.push({
      field: `${base}.resultType`,
      message: 'legacy field; replace with "mode" ("view" or "background")',
    })
  }
  if (cmdRaw.view !== undefined) {
    errors.push({
      field: `${base}.view`,
      message: 'legacy field; use "component" instead (required when mode="view")',
    })
  }

  if (cmd.mode === undefined) {
    errors.push({
      field: `${base}.mode`,
      message: 'required — must be "view" or "background"',
    })
  } else if (!VALID_COMMAND_MODES.includes(cmd.mode)) {
    errors.push({
      field: `${base}.mode`,
      message: `invalid mode "${String(cmd.mode)}"; must be one of: ${VALID_COMMAND_MODES.join(', ')}`,
    })
  }

  if (cmd.mode === 'view' && !cmd.component) {
    errors.push({
      field: `${base}.component`,
      message: 'required when mode is "view" — names the Svelte component entry',
    })
  }

  if (cmd.schedule) {
    const schedule = cmd.schedule
    const intField = `${base}.schedule.intervalSeconds`
    if (
      typeof schedule.intervalSeconds !== 'number' ||
      !Number.isInteger(schedule.intervalSeconds) ||
      schedule.intervalSeconds < 1
    ) {
      errors.push({ field: intField, message: 'intervalSeconds must be a positive integer' })
    } else if (schedule.intervalSeconds < 10) {
      errors.push({
        field: intField,
        message: `Minimum schedule interval is 10 seconds, got ${schedule.intervalSeconds}`,
      })
    } else if (schedule.intervalSeconds > 86400) {
      errors.push({
        field: intField,
        message: `Maximum schedule interval is 86400 seconds (24 hours), got ${schedule.intervalSeconds}`,
      })
    }

    if (cmd.mode !== 'background') {
      errors.push({
        field: `${base}.schedule`,
        message: 'Scheduled commands must have mode "background"',
      })
    }
  }
}

export function validateArguments(
  args: CommandArgument[] | undefined,
  pathPrefix: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!args) return errors;
  if (!Array.isArray(args)) {
    errors.push({ field: pathPrefix, message: 'arguments must be an array' });
    return errors;
  }

  if (args.length > MAX_ARGUMENTS_PER_COMMAND) {
    errors.push({
      field: pathPrefix,
      message: `a command can declare at most ${MAX_ARGUMENTS_PER_COMMAND} arguments (got ${args.length})`,
    });
  }

  const seen = new Set<string>();
  let sawOptional = false;
  args.forEach((a, i) => {
    const base = `${pathPrefix}[${i}]`;

    if (!a.name || typeof a.name !== 'string') {
      errors.push({ field: `${base}.name`, message: 'name is required' });
    } else if (!ARG_NAME_RE.test(a.name)) {
      errors.push({
        field: `${base}.name`,
        message: `name '${a.name}' must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
      });
    } else if (seen.has(a.name)) {
      errors.push({ field: `${base}.name`, message: `Duplicate argument name '${a.name}'` });
    } else {
      seen.add(a.name);
    }

    if (!a.type) {
      errors.push({ field: `${base}.type`, message: 'type is required' });
    } else if (!VALID_ARGUMENT_TYPES.includes(a.type)) {
      errors.push({
        field: `${base}.type`,
        message: `Unknown argument type '${
          a.type
        }'. Must be one of: ${VALID_ARGUMENT_TYPES.join(', ')}`,
      });
    }

    const isRequired = a.required === true;
    if (sawOptional && isRequired) {
      errors.push({
        field: base,
        message: `required argument '${a.name}' cannot follow an optional argument`,
      });
    }
    if (!isRequired) sawOptional = true;

    if (a.type === 'dropdown') {
      if (!a.data || !Array.isArray(a.data) || a.data.length === 0) {
        errors.push({
          field: `${base}.data`,
          message: 'dropdown requires non-empty data array',
        });
      } else {
        a.data.forEach((d, di) => {
          if (!d || !d.value || !d.title) {
            errors.push({
              field: `${base}.data[${di}]`,
              message: 'each dropdown option needs value and title',
            });
          }
        });
        if (a.default !== undefined) {
          const defaultStr = String(a.default);
          if (!a.data.some((d) => d && d.value === defaultStr)) {
            errors.push({
              field: `${base}.default`,
              message: `default '${defaultStr}' not in data[]`,
            });
          }
        }
      }
    }

    if (a.default !== undefined) {
      if (a.type === 'number' && typeof a.default !== 'number') {
        errors.push({ field: `${base}.default`, message: 'number default must be a number' });
      } else if ((a.type === 'text' || a.type === 'password') && typeof a.default !== 'string') {
        errors.push({
          field: `${base}.default`,
          message: `${a.type} default must be a string`,
        });
      }
    }
  });

  return errors;
}

export function validatePreferences(
  prefs: PreferenceDeclaration[] | undefined,
  pathPrefix: string
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!prefs) return errors;
  if (!Array.isArray(prefs)) {
    errors.push({ field: pathPrefix, message: 'preferences must be an array' });
    return errors;
  }

  const seen = new Set<string>();
  prefs.forEach((p, i) => {
    const base = `${pathPrefix}[${i}]`;

    if (!p.name || typeof p.name !== 'string') {
      errors.push({ field: `${base}.name`, message: 'name is required' });
    } else if (!PREF_NAME_RE.test(p.name)) {
      errors.push({
        field: `${base}.name`,
        message: `name '${p.name}' must match /^[a-zA-Z_][a-zA-Z0-9_]*$/`,
      });
    } else if (seen.has(p.name)) {
      errors.push({ field: `${base}.name`, message: `Duplicate preference name '${p.name}'` });
    } else {
      seen.add(p.name);
    }

    if (!p.type) {
      errors.push({ field: `${base}.type`, message: 'type is required' });
    } else if (!VALID_PREFERENCE_TYPES.includes(p.type)) {
      errors.push({
        field: `${base}.type`,
        message: `Unknown preference type '${
          p.type
        }'. Must be one of: ${VALID_PREFERENCE_TYPES.join(', ')}`,
      });
    }

    if (!p.title || typeof p.title !== 'string' || !p.title.trim()) {
      errors.push({ field: `${base}.title`, message: 'title is required' });
    }

    if (p.type === 'dropdown') {
      if (!p.data || !Array.isArray(p.data) || p.data.length === 0) {
        errors.push({
          field: `${base}.data`,
          message: 'dropdown requires non-empty data array',
        });
      } else {
        p.data.forEach((d, di) => {
          if (!d.value || !d.title) {
            errors.push({
              field: `${base}.data[${di}]`,
              message: 'each dropdown option needs value and title',
            });
          }
        });
        if (p.default !== undefined) {
          const defaultStr = String(p.default);
          if (!p.data.some((d) => d.value === defaultStr)) {
            errors.push({
              field: `${base}.default`,
              message: `default '${defaultStr}' not in data[]`,
            });
          }
        }
      }
    }

    if (p.type === 'number' && p.default !== undefined && typeof p.default !== 'number') {
      errors.push({ field: `${base}.default`, message: 'number default must be a number' });
    }
    if (p.type === 'checkbox' && p.default !== undefined && typeof p.default !== 'boolean') {
      errors.push({ field: `${base}.default`, message: 'checkbox default must be a boolean' });
    }
  });

  return errors;
}
