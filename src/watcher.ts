import { watch, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
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
    const resolved = resolve(dir);
    if (watchers.has(resolved)) return;
    try {
      const w = watch(resolved, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (eventType === "change") return; // in-place modifications are not file-arrival events
        const fullPath = join(resolved, filename);
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
      watchers.set(resolved, w);
      log("info", `Watching: ${resolved}`);
    } catch {
      log("warn", `Watch path does not exist, skipping: ${resolved}`);
    }
  }

  for (const dir of paths) {
    addPath(dir);
  }

  return {
    add: (dir: string) => addPath(dir),
    unwatch: (dir: string) => {
      const resolved = resolve(dir);
      const w = watchers.get(resolved);
      if (w) {
        w.close();
        watchers.delete(resolved);
        log("info", `Stopped watching: ${resolved}`);
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
