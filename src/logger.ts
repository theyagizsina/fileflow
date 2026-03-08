import { appendFileSync, existsSync, statSync, renameSync, unlinkSync } from "fs";
import { extname, basename, dirname, join } from "path";

let logFilePath: string | null = null;
let maxSizeMb = 10;
let rotateEnabled = true;

export function initLogger(config: { path: string; max_size_mb: number; rotate: boolean }) {
  logFilePath = config.path;
  maxSizeMb = config.max_size_mb;
  rotateEnabled = config.rotate;
}

export function formatLogLine(level: string, message: string): string {
  const now = new Date();
  const ts = now.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  return `[${ts}] ${level.toUpperCase()} ${message}`;
}

export function log(level: string, message: string): void {
  const line = formatLogLine(level, message);
  console.log(line);

  if (logFilePath) {
    if (rotateEnabled) rotateIfNeeded();
    appendFileSync(logFilePath, line + "\n");
  }
}

const MAX_ROTATED_FILES = 3;

export function rotateLog(logPath: string, maxSizeBytes: number): void {
  if (!existsSync(logPath)) return;
  try {
    const stats = statSync(logPath);
    if (stats.size <= maxSizeBytes) return;

    const dir = dirname(logPath);
    const ext = extname(logPath);
    const base = basename(logPath, ext);

    // Build rotated path: base.N.ext or base.N (if no extension)
    const rotatedPath = (n: number) =>
      ext
        ? join(dir, `${base}.${n}${ext}`)
        : join(dir, `${base}.${n}`);

    // Delete the oldest if it exists
    const oldest = rotatedPath(MAX_ROTATED_FILES);
    if (existsSync(oldest)) unlinkSync(oldest);

    // Cascade: shift N → N+1, from highest to lowest
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      const src = rotatedPath(i);
      if (existsSync(src)) renameSync(src, rotatedPath(i + 1));
    }

    // Move current log to .1
    renameSync(logPath, rotatedPath(1));
  } catch {}
}

function rotateIfNeeded(): void {
  if (!logFilePath || !existsSync(logFilePath)) return;
  rotateLog(logFilePath, maxSizeMb * 1024 * 1024);
}
