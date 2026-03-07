import { watch, readdirSync, statSync } from "fs";
import { join } from "path";
import { log } from "./logger";

export type FileEventType = "created" | "renamed";

export interface FileEvent {
  type: FileEventType;
  path: string;
}

export interface ScanStats {
  errors: number;
}

export type FileEventCallback = (event: FileEvent) => void;

export function startWatching(paths: string[], callback: FileEventCallback): void {
  for (const dir of paths) {
    try {
      watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = join(dir, filename);

        // fs.watch emits 'rename' for both create and rename on Windows
        // We treat both as potential new files
        try {
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            callback({
              type: eventType === "rename" ? "renamed" : "created",
              path: fullPath,
            });
          }
        } catch {
          // File may have been deleted between event and stat
        }
      });
      log("info", `Watching: ${dir}`);
    } catch (e) {
      log("warn", `Watch path does not exist, skipping: ${dir}`);
    }
  }
}

export function scanExisting(paths: string[], stats?: ScanStats): string[] {
  const files: string[] = [];

  function scanDirRecursive(dir: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          files.push(fullPath);
        } else if (stat.isDirectory()) {
          scanDirRecursive(fullPath);
        }
      } catch (e) {
        stats && (stats.errors += 1);
        log("warn", `Failed to stat entry during scan, skipping: ${fullPath} (${e})`);
      }
    }
  }

  for (const dir of paths) {
    try {
      scanDirRecursive(dir);
    } catch (e) {
      stats && (stats.errors += 1);
      log("warn", `Watch path not readable during scan, skipping: ${dir} (${e})`);
    }
  }
  return files;
}
