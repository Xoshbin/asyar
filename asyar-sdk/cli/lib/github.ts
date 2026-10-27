export class GitHubClient {
  constructor(private token: string) {}

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
    } catch (err: any) {
      throw new Error(`Could not connect to GitHub API. Please check your internet connection.`);
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`GitHub API ${response.status}: ${err.message ?? response.statusText}`);
    }

    return response.json();
  }

  async getAuthenticatedUser(): Promise<{ login: string }> {
    return this.request('/user');
  }

  async createRepo(opts: {
    name: string;
    description: string;
    isPrivate: boolean;
  }): Promise<{ html_url: string; clone_url: string; ssh_url: string }> {
    return this.request('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: opts.name,
        description: opts.description,
        private: opts.isPrivate,
        auto_init: false,
      }),
    });
  }

  async getRepo(
    owner: string,
    repo: string,
  ): Promise<{ html_url: string; clone_url: string; ssh_url: string }> {
    return this.request(`/repos/${owner}/${repo}`);
  }

  async getRelease(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<{
    id: number;
    upload_url: string;
    html_url: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
    }>;
  } | null> {
    try {
      return await this.request(`/repos/${owner}/${repo}/releases/tags/${tag}`);
    } catch {
      return null;
    }
  }

  /**
   * `targetCommitish` pins a new tag to that commit. Without it GitHub
   * tags the default branch tip, which may not be what was built.
   */
  async createRelease(
    owner: string,
    repo: string,
    opts: { tag: string; name: string; body: string; targetCommitish?: string },
  ): Promise<{ id: number; upload_url: string; html_url: string }> {
    return this.request(`/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: opts.tag,
        ...(opts.targetCommitish ? { target_commitish: opts.targetCommitish } : {}),
        name: opts.name,
        body: opts.body,
        draft: false,
        prerelease: false,
      }),
    });
  }

  /** Sha of the commit a branch, tag or sha points at (annotated tags are peeled). */
  async getCommitSha(owner: string, repo: string, ref: string): Promise<string> {
    const commit = await this.request(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
    return commit.sha;
  }

  async uploadReleaseAsset(
    uploadUrl: string,
    fileBuffer: Buffer,
    fileName: string,
  ): Promise<{ browser_download_url: string }> {
    const url = uploadUrl.replace('{?name,label}', `?name=${fileName}`);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/zip',
        },
        body: fileBuffer as any,
      });
    } catch (err: any) {
      throw new Error(
        `Could not connect to GitHub to upload release asset. Please check your internet connection.`,
      );
    }
    if (!response.ok) {
      throw new Error(`Failed to upload release asset: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
}
