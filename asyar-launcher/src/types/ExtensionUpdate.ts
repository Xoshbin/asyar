export interface AvailableUpdate {
  extensionId: string;
  name: string;
  slug: string;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  checksum: string;
}

export type UpdateProgressStatus =
  | { status: 'checking' }
  | { status: 'downloading'; extensionId: string; extensionName: string }
  | { status: 'verifying'; extensionId: string }
  | { status: 'extracting'; extensionId: string }
  | { status: 'swapping'; extensionId: string }
  | { status: 'complete'; extensionId: string }
  | { status: 'failed'; extensionId: string; error: string };
