import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const CONFIG_DIR  = path.join(os.homedir(), '.asyar')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export interface AsyarConfig {
  storeUrl?: string
  extensions?: Record<string, {
    repoUrl: string
  }>
}

export function readConfig(): AsyarConfig {
  if (!fs.existsSync(CONFIG_FILE)) return {}
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function writeConfig(updates: Partial<AsyarConfig>): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const current = readConfig()
  const merged  = deepMerge(current, updates)
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2))
}

export function getExtensionRepoUrl(extensionId: string): string | null {
  const config = readConfig()
  return config.extensions?.[extensionId]?.repoUrl ?? null
}

export function saveExtensionRepoUrl(extensionId: string, repoUrl: string): void {
  writeConfig({
    extensions: {
      [extensionId]: { repoUrl }
    }
  })
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] instanceof Object &&
      !Array.isArray(source[key]) &&
      target[key] instanceof Object
    ) {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}
