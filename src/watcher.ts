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

export interface WatcherHandle {
  add: (dir: string) => void;
  unwatch: (dir: string) => void;
  close: () => void;
}

export function startWatching(paths: string[], callback: FileEventCallback): WatcherHandle {
  const watchers = new Map<string, ReturnType<typeof watch>>();

  function addPath(dir: string): void {
    if (watchers.has(dir)) return;
    try {
      const w = watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = join(dir, filename);
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
      watchers.set(dir, w);
      log("info", `Watching: ${dir}`);
    } catch {
      log("warn", `Watch path does not exist, skipping: ${dir}`);
    }
  }

  for (const dir of paths) {
    addPath(dir);
  }

  return {
    add: (dir: string) => addPath(dir),
    unwatch: (dir: string) => {
      const w = watchers.get(dir);
      if (w) {
        w.close();
        watchers.delete(dir);
        log("info", `Stopped watching: ${dir}`);
      }
    },
    close: () => {
      for (const w of watchers.values()) w.close();
      watchers.clear();
    },
  };
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
