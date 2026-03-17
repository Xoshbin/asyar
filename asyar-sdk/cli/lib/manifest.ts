import * as fs from 'fs'
import * as path from 'path'
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
  type?: 'result' | 'view'
  defaultView?: string
  searchable?: boolean
  main?: string
}

export interface ManifestCommand {
  id: string
  name: string
  description: string
  resultType?: 'view' | 'no-view'
  view?: string
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
  'shell:execute',
  'network',
] as const

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
  } else if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(manifest.id)) {
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

  if (!manifest.commands || manifest.commands.length === 0) {
    errors.push({ field: 'commands', message: 'at least one command is required' })
  } else {
    manifest.commands.forEach((cmd, i) => {
      if (!cmd.id) errors.push({ field: `commands[${i}].id`, message: 'required' })
      if (!cmd.name) errors.push({ field: `commands[${i}].name`, message: 'required' })
      if (!cmd.resultType) {
        errors.push({
          field: `commands[${i}].resultType`,
          message: 'must be "view" or "no-view"',
        })
      }
      if (cmd.resultType === 'view' && !cmd.view && !manifest.defaultView) {
        errors.push({
          field: `commands[${i}].view`,
          message: 'required when resultType is "view" and no defaultView is specified in manifest',
        })
      }
    })
  }

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

  return errors
}
