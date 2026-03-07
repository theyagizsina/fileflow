import * as fs from "fs";
import { join, extname, basename } from "path";
import { log } from "./logger";

export function uniqueDestination(destDir: string, fileName: string): string {
  const dest = join(destDir, fileName);
  if (!fs.existsSync(dest)) return dest;

  const ext = extname(fileName);
  const stem = basename(fileName, ext);

  for (let i = 1; i < 2_147_483_647; i++) {
    const newName = ext ? `${stem}_${i}${ext}` : `${stem}_${i}`;
    const candidate = join(destDir, newName);
    if (!fs.existsSync(candidate)) return candidate;
  }

  return join(destDir, `${fileName}_dup`);
}

export function crossDriveMove(source: string, dest: string): void {
  const sourceSize = fs.statSync(source).size;

  try {
    fs.copyFileSync(source, dest);
  } catch (copyErr) {
    // Clean up any partial destination file before re-throwing
    try {
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
    } catch {
      // Best-effort cleanup; ignore errors
    }
    throw copyErr;
  }

  // Verify the copy succeeded by comparing file sizes
  const destSize = fs.statSync(dest).size;
  if (destSize !== sourceSize) {
    // Clean up the bad copy
    try {
      fs.unlinkSync(dest);
    } catch {
      // Best-effort cleanup
    }
    throw new Error(
      `Copy size mismatch: source ${source} (${sourceSize} bytes) vs dest ${dest} (${destSize} bytes)`
    );
  }

  // Copy verified; now delete source
  try {
    fs.unlinkSync(source);
  } catch (unlinkErr) {
    // Source still exists AND copy exists at dest — duplication!
    log(
      "warn",
      `Failed to delete source after copy — duplicate files exist: source=${source} dest=${dest}`
    );
    throw new Error(
      `Failed to delete source after copy — duplicate files exist: source=${source} dest=${dest}`,
      { cause: unlinkErr }
    );
  }
}

export function moveFile(source: string, destDir: string, dryRun: boolean): string {
  const fileName = basename(source);

  if (!dryRun && !fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const finalDest = uniqueDestination(destDir, fileName);

  if (dryRun) {
    log("info", `[DRY-RUN] WOULD MOVE ${source} -> ${finalDest}`);
    return finalDest;
  }

  try {
    fs.renameSync(source, finalDest);
  } catch (err: any) {
    // Only fallback to copy+delete for cross-device errors
    if (err?.code !== "EXDEV") throw err;
    crossDriveMove(source, finalDest);
  }

  return finalDest;
}
