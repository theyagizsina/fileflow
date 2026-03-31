import { watch } from "fs";
import { resolve } from "path";
import { loadConfig, expandEnvVars } from "./config";
import type { Config } from "./config";

export interface ConfigDiff {
  addedPaths: string[];
  removedPaths: string[];
}

export interface ConfigReloaderOptions {
  configPath: string;
  currentConfig: Config;
  onReload: (newConfig: Config, diff: ConfigDiff) => void;
  logFn: (level: string, message: string) => void;
}

function diffPaths(oldPaths: string[], newPaths: string[]): ConfigDiff {
  const oldSet = new Set(oldPaths.map((p) => resolve(p)));
  const newSet = new Set(newPaths.map((p) => resolve(p)));
  return {
    addedPaths: [...newSet].filter((p) => !oldSet.has(p)),
    removedPaths: [...oldSet].filter((p) => !newSet.has(p)),
  };
}

export function startConfigReloader(opts: ConfigReloaderOptions): () => void {
  const { configPath, onReload, logFn } = opts;
  let currentConfig = opts.currentConfig;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const configDir = resolve(configPath, "..");
  const configFile = resolve(configPath).split(/[\\/]/).pop()!;

  let closed = false;

  const watcher = watch(configDir, (_, filename) => {
    if (closed) return;
    if (!filename) return;
    if (filename !== configFile) return;

    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      if (closed) return;
      try {
        const newConfig = loadConfig(configPath);
        const oldPaths = currentConfig.watch.paths.map(expandEnvVars);
        const newPaths = newConfig.watch.paths.map(expandEnvVars);
        const diff = diffPaths(oldPaths, newPaths);
        currentConfig = newConfig;

        logFn(
          "info",
          `CONFIG_RELOADED — rules=${newConfig.rules.length} watch_paths=${newConfig.watch.paths.length}`
        );

        if (diff.addedPaths.length > 0 || diff.removedPaths.length > 0) {
          const added = diff.addedPaths.map((p) => `+${p}`).join(", ");
          const removed = diff.removedPaths.map((p) => `-${p}`).join(", ");
          const parts = [added, removed].filter(Boolean).join(", ");
          logFn("info", `CONFIG_RELOAD watch paths changed: ${parts}`);
        }

        onReload(newConfig, diff);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logFn("warn", `CONFIG_RELOAD_FAILED ${configPath} (reason: ${msg})`);
      }
    }, 500);
  });

  return () => {
    closed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}
