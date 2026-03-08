import { writeFileSync, renameSync, unlinkSync, existsSync } from "fs";

export interface UpdateCheckResult {
  available: boolean;
  latestVersion: string;
  downloadUrl?: string;
}

export interface CheckForUpdateOptions {
  currentVersion: string;
  fetchFn: typeof fetch;
  repoOwner: string;
  repoName: string;
}

export async function checkForUpdate(opts: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const { currentVersion, fetchFn, repoOwner, repoName } = opts;
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;

  const response = await fetchFn(url, {
    headers: { "User-Agent": "FileFlow-Updater", Accept: "application/vnd.github.v3+json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to check for updates (HTTP ${response.status})`);
  }

  const release = (await response.json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };
  const latestVersion = release.tag_name.replace(/^v/, "");

  const asset = release.assets.find((a) => a.name === "fileflow.exe");
  if (!asset) {
    throw new Error("fileflow.exe not found in release assets");
  }

  if (latestVersion === currentVersion) {
    return { available: false, latestVersion };
  }

  return { available: true, latestVersion, downloadUrl: asset.browser_download_url };
}

export interface PerformUpdateOptions {
  exePath: string;
  downloadUrl: string;
  fetchFn: typeof fetch;
}

export interface UpdateResult {
  success: boolean;
}

export async function performUpdate(opts: PerformUpdateOptions): Promise<UpdateResult> {
  const { exePath, downloadUrl, fetchFn } = opts;
  const newPath = exePath + ".new";
  const oldPath = exePath + ".old";

  const response = await fetchFn(downloadUrl, {
    headers: { "User-Agent": "FileFlow-Updater" },
  });

  if (!response.ok) {
    try { if (existsSync(newPath)) unlinkSync(newPath); } catch {}
    throw new Error(`Failed to download update (HTTP ${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  writeFileSync(newPath, Buffer.from(buffer));

  try {
    if (existsSync(oldPath)) unlinkSync(oldPath);
    renameSync(exePath, oldPath);
    renameSync(newPath, exePath);
  } catch (e) {
    try {
      if (existsSync(oldPath) && !existsSync(exePath)) {
        renameSync(oldPath, exePath);
      }
      if (existsSync(newPath)) unlinkSync(newPath);
    } catch {}
    throw new Error(`Failed to replace binary: ${e}`);
  }

  return { success: true };
}

export function cleanupOldBinary(exePath: string): void {
  const oldPath = exePath + ".old";
  try {
    if (existsSync(oldPath)) unlinkSync(oldPath);
  } catch {
    // Best-effort cleanup, ignore errors (file may be locked)
  }
}
