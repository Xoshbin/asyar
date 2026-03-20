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
    const response = await fetch(`${STORE_URL}/api/extensions/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify(payload),
    })

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

    // Throw only for unexpected errors
    let errorMessage = data.error ?? data.message ?? 'Unknown error';
    if (data.errors) {
        errorMessage += ': ' + JSON.stringify(data.errors);
    }
    throw new Error(`${errorMessage} (Status: ${response.status})`)
  }
}
