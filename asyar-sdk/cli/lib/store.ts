import { STORE_URL } from './auth'

export class AuthExpiredError extends Error {
  constructor() {
    super('CLI session expired')
    this.name = 'AuthExpiredError'
  }
}

export interface SubmitResult {
  status:      'submitted' | 'already_pending' | 'already_approved'
  message:     string
  trackingUrl?: string
}

export class StoreClient {
  constructor(private token: string) {}

  async submitExtension(payload: {
    repoUrl:     string
    extensionId: string
    version:     string
    releaseTag:  string
    downloadUrl: string
    checksum:    string
  }): Promise<SubmitResult> {
    let response: Response
    try {
      response = await fetch(`${STORE_URL}/api/extensions/submit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type':  'application/json',
          'Accept':        'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (error: any) {
      throw new Error(`Could not connect to the Asyar Store at ${STORE_URL}. Please check your internet connection or verify the store is online.`)
    }

    const data = await response.json()

    if (response.ok) {
      return {
        status:      'submitted',
        message:     data.message,
        trackingUrl: data.trackingUrl,
      }
    }

    // Handle known resumable states — do not throw
    if (response.status === 409) {
      if (data.error?.includes('pending review')) {
        return {
          status:      'already_pending',
          message:     data.error,
          trackingUrl: data.trackingUrl,
        }
      }
      if (data.error?.includes('already published')) {
        return {
          status:      'already_approved',
          message:     data.error,
        }
      }
    }

    // Handle 401 explicitly
    if (response.status === 401) {
      throw new AuthExpiredError()
    }

    // Store returns 500 with a SQL duplicate key error when version already exists
    const rawError: string = data.error ?? data.message ?? ''
    if (rawError.includes('Duplicate entry') || rawError.includes('1062')) {
      return {
        status:      'already_pending',
        message:     rawError,
        trackingUrl: data.trackingUrl,
      }
    }

    // Throw only for unexpected errors
    let errorMessage = rawError || 'Unknown error';
    if (data.errors) {
        errorMessage += ': ' + JSON.stringify(data.errors);
    }
    throw new Error(`${errorMessage} (Status: ${response.status})`)
  }
}
