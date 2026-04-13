import * as fs from 'node:fs'
import * as path from 'node:path'
import * as semver from 'semver'

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
  type?: 'result' | 'view' | 'theme'
  defaultView?: string
  searchable?: boolean
  main?: string
  preferences?: PreferenceDeclaration[]
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

export interface ManifestCommand {
  id: string
  name: string
  description: string
  resultType?: 'view' | 'no-view' | 'result'
  view?: string
  schedule?: {
    intervalSeconds: number;
  };
  preferences?: PreferenceDeclaration[];
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
      if (!VALID_PERMISSIONS.includes(perm as any)) {
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

  if (manifest.type === 'theme') {
    // Theme extensions need no commands and no build artifacts
    if (!fs.existsSync(path.join(cwd, 'theme.json'))) {
      errors.push({ field: 'theme.json', message: 'required for theme extensions' })
    }
  } else {
    if (!manifest.commands || manifest.commands.length === 0) {
      errors.push({ field: 'commands', message: 'at least one command is required' })
    } else {
      manifest.commands.forEach((cmd, i) => {
        if (!cmd.id) errors.push({ field: `commands[${i}].id`, message: 'required' })
        if (!cmd.name) errors.push({ field: `commands[${i}].name`, message: 'required' })
        if (!cmd.resultType) {
          errors.push({
            field: `commands[${i}].resultType`,
            message: 'must be "view" or "no-view" or "result"',
          })
        }
        if (cmd.resultType === 'view' && !cmd.view && !manifest.defaultView) {
          errors.push({
            field: `commands[${i}].view`,
            message: 'required when resultType is "view" and no defaultView is specified in manifest',
          });
        }

        // Validate schedule declarations
        if (cmd.schedule) {
          const schedule = cmd.schedule;
          if (typeof schedule.intervalSeconds !== 'number' || !Number.isInteger(schedule.intervalSeconds) || schedule.intervalSeconds < 1) {
            errors.push({
              field: `commands[${i}].schedule.intervalSeconds`,
              message: 'intervalSeconds must be a positive integer',
            });
          } else if (schedule.intervalSeconds < 60) {
            errors.push({
              field: `commands[${i}].schedule.intervalSeconds`,
              message: `Minimum schedule interval is 60 seconds, got ${schedule.intervalSeconds}`,
            });
          } else if (schedule.intervalSeconds > 86400) {
            errors.push({
              field: `commands[${i}].schedule.intervalSeconds`,
              message: `Maximum schedule interval is 86400 seconds (24 hours), got ${schedule.intervalSeconds}`,
            });
          }

          if (cmd.resultType !== 'no-view') {
            errors.push({
              field: `commands[${i}].schedule`,
              message: 'Scheduled commands must have resultType "no-view"',
            });
          }
        }
      })
    }
  }

  // Validate asyarSdk if present
  if (manifest.asyarSdk !== undefined) {
    if (typeof manifest.asyarSdk !== 'string' || !semver.validRange(manifest.asyarSdk)) {
      errors.push({
        field: 'asyarSdk',
        message: `must be a valid semver range (e.g., "^1.2.0"), got: ${manifest.asyarSdk}`,
      })
    }
  }

  // Validate minAppVersion if present
  if (manifest.minAppVersion !== undefined) {
    if (typeof manifest.minAppVersion !== 'string' || !semver.valid(manifest.minAppVersion)) {
      errors.push({
        field: 'minAppVersion',
        message: `must be a valid semver version (e.g., "0.1.0"), got: ${manifest.minAppVersion}`,
      })
    }
  }

  // Validate platforms if present
  if (manifest.platforms !== undefined) {
    if (!Array.isArray(manifest.platforms)) {
      errors.push({ field: 'platforms', message: 'must be an array' })
    } else {
      manifest.platforms.forEach((p) => {
        if (!VALID_PLATFORMS.includes(p as any)) {
          errors.push({
            field: 'platforms',
            message: `"${p}" is not a valid platform. Valid values: ${VALID_PLATFORMS.join(', ')}`,
          })
        }
      })
    }
  }

  // Warn if asyarSdk is missing (soft warning, not an error)
  if (!manifest.asyarSdk && manifest.type !== 'theme') {
    console.warn(
      '⚠️  Consider adding "asyarSdk" to your manifest.json to declare SDK compatibility (e.g., "^1.2.0")'
    )
  }

  if (manifest.type !== 'theme') {
    if (!fs.existsSync(path.join(cwd, 'index.html'))) {
      errors.push({
        field: 'index.html',
        message: 'not found in project root (required for iframe loading)',
      })
    }

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

  // Validate preferences
  errors.push(...validatePreferences(manifest.preferences, 'preferences'));
  manifest.commands.forEach((cmd, i) => {
    errors.push(...validatePreferences(cmd.preferences, `commands[${i}].preferences`));
  });

  return errors
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
