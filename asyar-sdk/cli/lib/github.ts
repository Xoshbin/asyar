export class GitHubClient {
  constructor(private token: string) { }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(
        `GitHub API ${response.status}: ${err.message ?? response.statusText}`
      )
    }

    return response.json()
  }

  async getAuthenticatedUser(): Promise<{ login: string }> {
    return this.request('/user')
  }

  async createRepo(opts: {
    name: string
    description: string
    isPrivate: boolean
  }): Promise<{ html_url: string; clone_url: string; ssh_url: string }> {
    return this.request('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: opts.name,
        description: opts.description,
        private: opts.isPrivate,
        auto_init: false,  // creates initial commit so we can push immediately
      }),
    })
  }

  async getRelease(
    owner: string,
    repo: string,
    tag: string
  ): Promise<any | null> {
    try {
      return await this.request(`/repos/${owner}/${repo}/releases/tags/${tag}`)
    } catch {
      return null
    }
  }

  async createRelease(
    owner: string,
    repo: string,
    opts: { tag: string; name: string; body: string }
  ): Promise<{ id: number; upload_url: string; html_url: string }> {
    return this.request(`/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: opts.tag,
        name: opts.name,
        body: opts.body,
        draft: false,
        prerelease: false,
      }),
    })
  }

  async uploadReleaseAsset(
    uploadUrl: string,
    fileBuffer: Buffer,
    fileName: string
  ): Promise<{ browser_download_url: string }> {
    const url = uploadUrl.replace('{?name,label}', `?name=${fileName}`)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/zip',
      },
      body: fileBuffer as any,
    })
    if (!response.ok) {
      throw new Error(
        `Failed to upload release asset: ${response.status} ${response.statusText}`
      )
    }
    return response.json()
  }
}
