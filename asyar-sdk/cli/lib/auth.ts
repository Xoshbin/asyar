import * as http from 'http'
import { exec } from 'child_process'
import chalk from 'chalk'
import ora from 'ora'

const KEYCHAIN_SERVICE   = 'asyar-cli'
const KEY_STORE_TOKEN    = 'store-session-token'
const KEY_GITHUB_TOKEN   = 'github-token'
const KEY_GITHUB_USERNAME = 'github-username'
const CLI_PORT           = 7123

export const STORE_URL =
  process.env.ASYAR_STORE_URL ?? 'https://asyar.org'

export async function getStoredAuth(): Promise<{
  storeToken: string
  githubUsername: string
} | null> {
  const keytar = require('keytar')
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

      const keytar = require('keytar')
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
  const keytar = require('keytar')
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

export async function getOrAuthorizeGitHub(): Promise<string> {
  const keytar = require('keytar')
  const existing = await keytar.getPassword(KEYCHAIN_SERVICE, KEY_GITHUB_TOKEN)
  if (existing) return existing

  const GITHUB_CLI_CLIENT_ID = 'Ov23liZOKJsuDznWHkDE'

  // Request device code
  let deviceResponse: Response
  try {
    deviceResponse = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_CLI_CLIENT_ID,
        scope:     'repo read:user',
      }).toString(),
    })
  } catch (err: any) {
    throw new Error('Could not connect to GitHub. Please check your internet connection.')
  }

  if (!deviceResponse.ok) {
    throw new Error('Failed to initiate GitHub device authorization')
  }

  const {
    device_code,
    user_code,
    verification_uri,
    expires_in,
    interval,
  } = await deviceResponse.json()

  // Show the code to the developer
  console.log()
  console.log(chalk.cyan('Authorizing GitHub access...'))
  console.log(
    chalk.bold('\nOpen this URL and enter the code below:')
  )
  console.log(chalk.underline(verification_uri))
  console.log()
  console.log(
    chalk.bgBlue.white.bold(` ${user_code} `)
  )
  console.log()

  // Open browser
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32'  ? 'start' :
    'xdg-open'
  exec(`${cmd} "${verification_uri}"`)

  const spinner = ora('Waiting for GitHub authorization...').start()
  const expiresAt = Date.now() + expires_in * 1000
  let pollInterval = interval * 1000

  // Poll for authorization
  while (Date.now() < expiresAt) {
    await sleep(pollInterval)

    let pollResponse: Response
    try {
      pollResponse = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Accept':       'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id:   GITHUB_CLI_CLIENT_ID,
            device_code,
            grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
          }).toString(),
        }
      )
    } catch (err: any) {
      spinner.fail('Connection failed')
      throw new Error('Could not connect to GitHub during authorization. Please check your internet connection.')
    }

    const result = await pollResponse.json()

    if (result.access_token) {
      spinner.succeed('GitHub authorized')
      const keytar = require('keytar')
      await keytar.setPassword(
        KEYCHAIN_SERVICE,
        KEY_GITHUB_TOKEN,
        result.access_token
      )
      return result.access_token
    }

    if (result.error === 'slow_down') {
      pollInterval += 5000
      continue
    }

    if (result.error === 'authorization_pending') {
      continue
    }

    if (result.error === 'expired_token') {
      spinner.fail('Authorization expired')
      throw new Error('GitHub authorization expired. Run the command again.')
    }

    if (result.error === 'access_denied') {
      spinner.fail('Authorization denied')
      throw new Error('GitHub authorization was denied.')
    }

    throw new Error(`Unexpected GitHub response: ${result.error}`)
  }

  spinner.fail('Authorization timed out')
  throw new Error('GitHub authorization timed out. Run the command again.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
