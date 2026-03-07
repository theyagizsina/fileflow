import { appendFileSync, existsSync, statSync, renameSync } from "fs";

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

function rotateIfNeeded(): void {
  if (!logFilePath || !existsSync(logFilePath)) return;
  try {
    const stats = statSync(logFilePath);
    if (stats.size > maxSizeMb * 1024 * 1024) {
      const rotated = `${logFilePath}.old`;
      renameSync(logFilePath, rotated);
    }
  } catch {}
}
