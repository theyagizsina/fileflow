export interface ReleaseAssetOptions {
  owner: string;
  repo: string;
  version: string;
  assetName: string;
}

export function normalizeVersionTag(version: string): string {
  const trimmed = version.trim();
  if (trimmed.length === 0) {
    throw new Error("Version is required");
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function buildReleaseAssetUrl(opts: ReleaseAssetOptions): string {
  const version = normalizeVersionTag(opts.version);
  return `https://github.com/${opts.owner}/${opts.repo}/releases/download/${version}/${opts.assetName}`;
}
