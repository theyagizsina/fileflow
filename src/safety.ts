import { existsSync, statSync, openSync, closeSync } from "fs";
import { extname } from "path";
import { log } from "./logger";

export function hasTempExtension(filePath: string, ignoreExtensions: string[]): boolean {
  const ext = extname(filePath).toLowerCase();
  if (!ext) return false;
  return ignoreExtensions.some((ie) => ie.toLowerCase() === ext);
}

export function isFileAccessible(filePath: string): boolean {
  // Phase 1: Try read-write open to detect exclusive locks (e.g. file still being written)
  try {
    const fd = openSync(filePath, "r+");
    closeSync(fd);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // EACCES/EPERM = read-only file, not a lock — fall through to phase 2
    if (code !== "EACCES" && code !== "EPERM") {
      // EBUSY, ENOENT, or other errors = truly inaccessible
      return false;
    }
  }

  // Phase 2: File is read-only (r+ failed with EACCES/EPERM). Verify it's actually readable.
  try {
    const fd = openSync(filePath, "r");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

interface PendingFile {
  path: string;
  lastSize: number;
  retryCount: number;
}

export class RetryQueue {
  private pending: Map<string, PendingFile> = new Map();

  constructor(private maxRetries: number) {}

  get size(): number {
    return this.pending.size;
  }

  add(path: string): void {
    if (this.pending.has(path)) return;
    this.pending.set(path, {
      path,
      lastSize: fileSize(path),
      retryCount: 0,
    });
  }

  drainReady(): string[] {
    const ready: string[] = [];
    const keep = new Map<string, PendingFile>();

    for (const [key, pending] of this.pending) {
      if (!existsSync(pending.path)) continue;

      pending.retryCount++;
      if (pending.retryCount > this.maxRetries) {
        log("warn", `GAVE UP on ${pending.path} after ${this.maxRetries} retries`);
        continue;
      }

      const currentSize = fileSize(pending.path);
      const sizeStable = currentSize === pending.lastSize;
      const accessible = isFileAccessible(pending.path);

      if (sizeStable && accessible) {
        ready.push(pending.path);
      } else {
        pending.lastSize = currentSize;
        keep.set(key, pending);
      }
    }

    this.pending = keep;
    return ready;
  }
}
