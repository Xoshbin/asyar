import * as http from 'http'
import * as keytar from 'keytar'
import { exec } from 'child_process'
import chalk from 'chalk'

const KEYCHAIN_SERVICE   = 'asyar-cli'
const KEY_STORE_TOKEN    = 'store-session-token'
const KEY_GITHUB_TOKEN   = 'github-token'
const KEY_GITHUB_USERNAME = 'github-username'
const CLI_PORT           = 7123

export const STORE_URL =
  process.env.ASYAR_STORE_URL ?? 'http://asyar-website.test'

export async function getStoredAuth(): Promise<{
  storeToken: string
  githubUsername: string
} | null> {
  const storeToken     = await keytar.getPassword(KEYCHAIN_SERVICE, KEY_STORE_TOKEN)
  const githubUsername = await keytar.getPassword(KEYCHAIN_SERVICE, KEY_GITHUB_USERNAME)
  if (!storeToken || !githubUsername) return null
  return { storeToken, githubUsername }
}

export async function login(): Promise<{
  storeToken: string
  githubUsername: string
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url      = new URL(req.url!, `http://localhost:${CLI_PORT}`)
      const token    = url.searchParams.get('token')
      const username = url.searchParams.get('username')

      if (!token || !username) {
        res.writeHead(400)
        res.end('Missing token or username')
        reject(new Error('OAuth callback missing required parameters'))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`
        <html><body style="font-family:system-ui;padding:40px;text-align:center">
          <h2>✓ Connected to Asyar Store</h2>
          <p>Logged in as <strong>${username}</strong>.</p>
          <p>You can close this tab and return to your terminal.</p>
        </body></html>
      `)

      await keytar.setPassword(KEYCHAIN_SERVICE, KEY_STORE_TOKEN, token)
      await keytar.setPassword(KEYCHAIN_SERVICE, KEY_GITHUB_USERNAME, username)

      server.close()
      resolve({ storeToken: token, githubUsername: username })
    })

    server.listen(CLI_PORT, () => {
      const authUrl =
        `${STORE_URL}/auth/github` +
        `?redirect=http://localhost:${CLI_PORT}/callback`

      console.log(chalk.cyan('\nConnect your GitHub account to publish to the Asyar Store.'))
      console.log(chalk.gray('Opening browser...\n'))

      const cmd =
        process.platform === 'darwin' ? 'open' :
        process.platform === 'win32'  ? 'start' :
        'xdg-open'
      exec(`${cmd} "${authUrl}"`)

      console.log(chalk.gray(`If the browser did not open, visit:\n${authUrl}\n`))
    })

    setTimeout(() => {
      server.close()
      reject(new Error('Authentication timed out after 5 minutes'))
    }, 5 * 60 * 1000)
  })
}

export async function logout(): Promise<void> {
  await keytar.deletePassword(KEYCHAIN_SERVICE, KEY_STORE_TOKEN)
  await keytar.deletePassword(KEYCHAIN_SERVICE, KEY_GITHUB_USERNAME)
  await keytar.deletePassword(KEYCHAIN_SERVICE, KEY_GITHUB_TOKEN)
}

export async function requireAuth(): Promise<{
  storeToken: string
  githubUsername: string
}> {
  const stored = await getStoredAuth()
  if (stored) return stored
  console.log(chalk.yellow('You are not logged in.'))
  return login()
}

export async function getOrPromptGitHubToken(): Promise<string> {
  const existing = await keytar.getPassword(KEYCHAIN_SERVICE, KEY_GITHUB_TOKEN)
  if (existing) return existing

  const { default: inquirer } = await import('inquirer')
  const { token } = await inquirer.prompt([{
    type: 'password',
    name: 'token',
    message: 'GitHub Personal Access Token (needs repo scope):',
    validate: (v: string) => v.length > 0 || 'Token is required',
  }])

  await keytar.setPassword(KEYCHAIN_SERVICE, KEY_GITHUB_TOKEN, token)
  return token
}
