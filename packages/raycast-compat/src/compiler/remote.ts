import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

export interface RaycastStoreAuthor {
  name: string;
  handle: string;
  avatar?: string | null;
}

export interface RaycastStoreCommand {
  id: string;
  name: string;
  title: string;
  description?: string;
  mode?: string;
}

export interface RaycastStoreListing {
  id: string;
  name: string;
  title: string;
  description: string;
  author: RaycastStoreAuthor;
  download_count: number;
  download_url: string;
  source_url?: string;
  icons?: {
    light?: string | null;
    dark?: string | null;
  };
  commands?: RaycastStoreCommand[];
}

/**
 * Searches the official Raycast Store public backend API for extensions matching the query.
 */
export async function searchRaycastStore(query: string): Promise<RaycastStoreListing[]> {
  const url = `https://backend.raycast.com/api/v1/store_listings/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Raycast/1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Raycast Store API returned HTTP ${res.status}: ${res.statusText}`);
  }

  const json: any = await res.json();
  return (json.data || json || []) as RaycastStoreListing[];
}

/**
 * Downloads and extracts a Raycast extension from the store or direct zip URL into outDir.
 */
export async function downloadRaycastExtension(
  identifierOrUrl: string,
  outDir?: string,
  directDownloadUrl?: string,
): Promise<{ extensionDir: string; listing?: RaycastStoreListing }> {
  let downloadUrl = directDownloadUrl ?? '';
  let extensionName = '';
  let matchedListing: RaycastStoreListing | undefined;

  const extractNameFromUrl = (urlStr: string): string => {
    try {
      const parsed = new URL(urlStr);
      const disposition = parsed.searchParams.get('response-content-disposition') || '';
      const fnMatch = disposition.match(/filename(?:\*=[^']*''|="?)([^";]+)"?/);
      if (fnMatch) {
        return path.basename(fnMatch[1].trim(), '.zip');
      }
      return path.basename(parsed.pathname, '.zip');
    } catch {
      return path.basename(urlStr, '.zip');
    }
  };

  if (downloadUrl) {
    extensionName = identifierOrUrl.startsWith('http')
      ? extractNameFromUrl(downloadUrl)
      : identifierOrUrl;
  } else if (identifierOrUrl.startsWith('http://') || identifierOrUrl.startsWith('https://')) {
    try {
      const parsed = new URL(identifierOrUrl);
      const disposition = parsed.searchParams.get('response-content-disposition') || '';
      const isZip =
        parsed.pathname.endsWith('.zip') ||
        identifierOrUrl.includes('.zip') ||
        parsed.hostname.includes('raycast-store-extensions') ||
        parsed.hostname.includes('amazonaws.com') ||
        disposition.includes('.zip');

      if (isZip) {
        downloadUrl = identifierOrUrl;
        extensionName = extractNameFromUrl(identifierOrUrl);
      } else {
        const match = identifierOrUrl.match(/raycast\.com\/[^/]+\/([^/?#]+)/);
        if (match) {
          extensionName = match[1];
        } else {
          extensionName = path.basename(parsed.pathname);
        }
      }
    } catch {
      extensionName = path.basename(identifierOrUrl, '.zip');
    }
  } else {
    extensionName = identifierOrUrl;
  }

  if (!downloadUrl) {
    console.log(`🔍 Searching Raycast Store for "${extensionName}"...`);
    const listings = await searchRaycastStore(extensionName);
    const found =
      listings.find((l) => l.name.toLowerCase() === extensionName.toLowerCase()) || listings[0];
    if (!found || !found.download_url) {
      throw new Error(`No Raycast extension found in store matching "${extensionName}".`);
    }
    matchedListing = found;
    downloadUrl = found.download_url;
    extensionName = found.name;
    console.log(
      `✓ Found: ${found.title} by ${found.author?.name || found.author?.handle} (${found.download_count.toLocaleString()} downloads)`,
    );
  }

  const finalDir = outDir ?? path.join(process.cwd(), 'extensions', `raycast-${extensionName}`);
  if (!fs.existsSync(finalDir)) {
    fs.mkdirSync(finalDir, { recursive: true });
  }

  console.log(`⬇️  Downloading extension package...`);
  const res = await fetch(downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download extension package from ${downloadUrl}: ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const tempZip = path.join(os.tmpdir(), `raycast-ext-${Date.now()}-${process.pid}.zip`);
  fs.writeFileSync(tempZip, Buffer.from(arrayBuffer));

  const tempExtract = path.join(os.tmpdir(), `raycast-extract-${Date.now()}-${process.pid}`);
  fs.mkdirSync(tempExtract, { recursive: true });

  try {
    try {
      execSync(`unzip -q -o "${tempZip}" -d "${tempExtract}"`, { stdio: 'pipe' });
    } catch {
      execSync(`tar -xf "${tempZip}" -C "${tempExtract}"`, { stdio: 'pipe' });
    }

    let rootToCopy = tempExtract;
    const entries = fs.readdirSync(tempExtract);
    if (entries.length === 1 && fs.statSync(path.join(tempExtract, entries[0])).isDirectory()) {
      rootToCopy = path.join(tempExtract, entries[0]);
    }

    for (const item of fs.readdirSync(rootToCopy)) {
      const src = path.join(rootToCopy, item);
      const dest = path.join(finalDir, item);
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }

    console.log(`✓ Extracted to: ${finalDir}`);
    return { extensionDir: finalDir, listing: matchedListing };
  } finally {
    try {
      fs.unlinkSync(tempZip);
    } catch {}
    try {
      fs.rmSync(tempExtract, { recursive: true, force: true });
    } catch {}
  }
}
