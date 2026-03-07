import { existsSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from "fs";
import { join, extname, basename } from "path";
import { log } from "./logger";

export function uniqueDestination(destDir: string, fileName: string): string {
  const dest = join(destDir, fileName);
  if (!existsSync(dest)) return dest;

  const ext = extname(fileName);
  const stem = basename(fileName, ext);

  for (let i = 1; i < 2_147_483_647; i++) {
    const newName = ext ? `${stem}_${i}${ext}` : `${stem}_${i}`;
    const candidate = join(destDir, newName);
    if (!existsSync(candidate)) return candidate;
  }

  return join(destDir, `${fileName}_dup`);
}

export function moveFile(source: string, destDir: string, dryRun: boolean): string {
  const fileName = basename(source);

  if (!dryRun && !existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const finalDest = uniqueDestination(destDir, fileName);

  if (dryRun) {
    log("info", `[DRY-RUN] WOULD MOVE ${source} -> ${finalDest}`);
    return finalDest;
  }

  try {
    renameSync(source, finalDest);
  } catch {
    // Cross-drive: rename fails, fallback to copy+delete
    copyFileSync(source, finalDest);
    unlinkSync(source);
  }

  return finalDest;
}
