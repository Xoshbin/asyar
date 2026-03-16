import { STORE_URL } from './auth'

export class StoreClient {
  constructor(private token: string) {}

  async submitExtension(payload: {
    repoUrl:     string
    extensionId: string
    version:     string
    releaseTag:  string
    downloadUrl: string
    checksum:    string
  }): Promise<{ message: string; trackingUrl: string }> {
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

    if (!response.ok) {
      throw new Error(data.error ?? `Store API returned ${response.status}`)
    }

    return data
  }
}
