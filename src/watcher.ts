import { watch, readdirSync, statSync } from "fs";
import { join } from "path";
import { log } from "./logger";

export type FileEventType = "created" | "renamed";

export interface FileEvent {
  type: FileEventType;
  path: string;
}

export type FileEventCallback = (event: FileEvent) => void;

export function startWatching(paths: string[], callback: FileEventCallback): void {
  for (const dir of paths) {
    try {
      watch(dir, (eventType, filename) => {
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

export function scanExisting(paths: string[]): string[] {
  const files: string[] = [];
  for (const dir of paths) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          if (statSync(fullPath).isFile()) {
            files.push(fullPath);
          }
        } catch {}
      }
    } catch {}
  }
  return files;
}
