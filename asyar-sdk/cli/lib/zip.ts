import AdmZip from 'adm-zip'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as os from 'os'

export interface ZipResult {
  zipPath:   string
  checksum:  string
  sizeBytes: number
}

export function packageExtension(
  cwd: string,
  extensionId: string,
  version: string,
  isTheme = false
): ZipResult {
  const zip = new AdmZip()

  if (isTheme) {
    // Theme packages: manifest.json + theme.json + optional fonts/
    zip.addLocalFile(path.join(cwd, 'manifest.json'))
    zip.addLocalFile(path.join(cwd, 'theme.json'))

    const fontsDir = path.join(cwd, 'fonts')
    if (fs.existsSync(fontsDir)) {
      addDirectoryToZip(zip, fontsDir, 'fonts')
    }
  } else {
    const distDir = path.join(cwd, 'dist')
    if (!fs.existsSync(distDir)) {
      throw new Error('dist/ not found. Run "asyar build" first.')
    }
    // manifest.json at root of zip
    zip.addLocalFile(path.join(cwd, 'manifest.json'))
    // dist/ contents flattened into zip root
    addDirectoryToZip(zip, distDir, '')
  }

  const zipFileName = `${extensionId}-${version}.zip`
  const zipPath     = path.join(os.tmpdir(), zipFileName)
  zip.writeZip(zipPath)

  const fileBuffer = fs.readFileSync(zipPath)
  const hash       = crypto.createHash('sha256').update(fileBuffer).digest('hex')

  return {
    zipPath,
    checksum:  `sha256:${hash}`,
    sizeBytes: fileBuffer.length,
  }
}

export function computeChecksum(buffer: Buffer): string {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  return `sha256:${hash}`
}

function addDirectoryToZip(zip: AdmZip, dirPath: string, zipPrefix: string) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const newPrefix = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name
      addDirectoryToZip(zip, fullPath, newPrefix)
    } else {
      zip.addLocalFile(fullPath, zipPrefix)
    }
  }
}
