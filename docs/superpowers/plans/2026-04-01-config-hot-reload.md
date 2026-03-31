# Config Hot-Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Watch `fileflow.toml` for changes while the daemon is running and automatically reload rules, watch paths, and safety settings without restarting.

**Architecture:** A new `src/config-reloader.ts` module wraps Node's `fs.watch` on the config file, debounces change events at 500ms, reloads and diffs the config, then calls back into `index.ts` which rebuilds the `Classifier` and updates the file watcher. `watcher.ts` is updated to return the watcher handle so paths can be added/removed at runtime.

**Tech Stack:** Bun, TypeScript strict, Node `fs.watch` (already used in `watcher.ts`), `loadConfig` from `src/config.ts`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/config-reloader.ts` | Create | Watch config file, debounce, reload, diff watch paths, call `onReload` |
| `src/config-reloader.test.ts` | Create | Unit tests for all config-reloader behaviour |
| `src/watcher.ts` | Modify line 18 | Return `FSWatcher` from `startWatching` |
| `src/watcher.test.ts` | Modify | Assert `startWatching` returns a watcher with `.close()` |
| `src/index.ts` | Modify daemon section (~line 435–465) | Wire `startConfigReloader`, make `classifier` and safety vars mutable, stop reloader on SIGINT |

---

## Task 1: Update `startWatching` to return the watcher handle

**Files:**
- Modify: `src/watcher.ts` line 18
- Modify: `src/watcher.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the bottom of `src/watcher.test.ts`, inside the existing `describe("startWatching", ...)` block:

```ts
test("returns a watcher handle with a close method", () => {
  const tmpDir2 = join(tmpdir(), `fileflow-watcher-handle-test-${Date.now()}`);
  mkdirSync(tmpDir2, { recursive: true });
  const handle = startWatching([tmpDir2], () => {});
  expect(typeof handle.close).toBe("function");
  handle.close();
  rmSync(tmpDir2, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
bun test src/watcher.test.ts
```

Expected: FAIL — `handle` is `undefined`, cannot read `.close` of undefined.

- [ ] **Step 3: Update `startWatching` to return the composite handle**

Replace the entire function in `src/watcher.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to confirm they pass**

```
bun test src/watcher.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Type-check**

```
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/watcher.ts src/watcher.test.ts
git commit -m "feat: return WatcherHandle from startWatching for dynamic path management"
```

---

## Task 2: Create `config-reloader.ts` with tests

**Files:**
- Create: `src/config-reloader.ts`
- Create: `src/config-reloader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/config-reloader.test.ts`:

```ts
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startConfigReloader } from "./config-reloader";

const VALID_TOML = (paths: string[], rules = 2) => `
[watch]
paths = ${JSON.stringify(paths)}

[safety]
ignore_extensions = [".tmp"]
stability_delay_seconds = 3
retry_interval_seconds = 10
max_retries = 30

[logging]
path = "fileflow.log"
` + (rules > 0 ? `
[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*"]
destination = "C:\\\\Dest\\\\Screenshots"
` : "") + (rules > 1 ? `
[[rules]]
name = "Videos"
type = "extension"
match = [".mp4"]
destination = "C:\\\\Dest\\\\Videos"
` : "");

describe("startConfigReloader", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `fileflow-reloader-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "fileflow.toml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns a stop function", () => {
    writeFileSync(configPath, VALID_TOML(["C:\\\\Downloads"]));
    const { loadConfig } = require("./config");
    const currentConfig = loadConfig(configPath);
    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: () => {},
      logFn: () => {},
    });
    expect(typeof stop).toBe("function");
    stop();
  });

  test("calls onReload with updated config and diff when file changes", async () => {
    const initialPaths = [join(tmpDir, "Downloads")];
    writeFileSync(configPath, VALID_TOML(initialPaths));
    const { loadConfig } = require("./config");
    const currentConfig = loadConfig(configPath);

    const reloads: { paths: string[]; added: string[]; removed: string[] }[] = [];

    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: (newConfig, diff) => {
        reloads.push({
          paths: newConfig.watch.paths,
          added: diff.addedPaths,
          removed: diff.removedPaths,
        });
      },
      logFn: () => {},
    });

    // Wait for watcher to initialise
    await new Promise((r) => setTimeout(r, 100));

    // Write a new config with an additional watch path
    const newPaths = [join(tmpDir, "Downloads"), join(tmpDir, "Desktop")];
    writeFileSync(configPath, VALID_TOML(newPaths));

    // Wait for debounce (500ms) + processing
    await new Promise((r) => setTimeout(r, 800));

    stop();

    expect(reloads.length).toBeGreaterThanOrEqual(1);
    const last = reloads[reloads.length - 1]!;
    expect(last.added).toContain(join(tmpDir, "Desktop"));
    expect(last.removed).toHaveLength(0);
  });

  test("debounces rapid change events — onReload called only once", async () => {
    writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));
    const { loadConfig } = require("./config");
    const currentConfig = loadConfig(configPath);

    let callCount = 0;
    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: () => { callCount++; },
      logFn: () => {},
    });

    await new Promise((r) => setTimeout(r, 100));

    // Write the file 5 times in quick succession
    for (let i = 0; i < 5; i++) {
      writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));
      await new Promise((r) => setTimeout(r, 50));
    }

    // Wait for debounce to fire
    await new Promise((r) => setTimeout(r, 800));

    stop();
    expect(callCount).toBeLessThanOrEqual(2); // At most 2 due to timing, ideally 1
  });

  test("does NOT call onReload when config has a parse error", async () => {
    writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));
    const { loadConfig } = require("./config");
    const currentConfig = loadConfig(configPath);

    let callCount = 0;
    const logMessages: string[] = [];

    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: () => { callCount++; },
      logFn: (_, msg) => logMessages.push(msg),
    });

    await new Promise((r) => setTimeout(r, 100));

    // Write broken TOML
    writeFileSync(configPath, "this is not valid toml !!! [[[");

    await new Promise((r) => setTimeout(r, 800));

    stop();

    expect(callCount).toBe(0);
    expect(logMessages.some((m) => m.includes("CONFIG_RELOAD_FAILED"))).toBe(true);
  });

  test("correctly diffs removed watch paths", async () => {
    const initialPaths = [join(tmpDir, "Downloads"), join(tmpDir, "Desktop")];
    writeFileSync(configPath, VALID_TOML(initialPaths));
    const { loadConfig } = require("./config");
    const currentConfig = loadConfig(configPath);

    const diffs: { added: string[]; removed: string[] }[] = [];

    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: (_, diff) => diffs.push({ added: diff.addedPaths, removed: diff.removedPaths }),
      logFn: () => {},
    });

    await new Promise((r) => setTimeout(r, 100));

    // Remove Desktop from paths
    writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));

    await new Promise((r) => setTimeout(r, 800));

    stop();

    expect(diffs.length).toBeGreaterThanOrEqual(1);
    const last = diffs[diffs.length - 1]!;
    expect(last.removed).toContain(join(tmpDir, "Desktop"));
    expect(last.added).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```
bun test src/config-reloader.test.ts
```

Expected: FAIL — `startConfigReloader` not found.

- [ ] **Step 3: Implement `src/config-reloader.ts`**

Create `src/config-reloader.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to confirm they pass**

```
bun test src/config-reloader.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Type-check**

```
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```
git add src/config-reloader.ts src/config-reloader.test.ts
git commit -m "feat: add config-reloader module with debounce and path diff"
```

---

## Task 3: Wire hot-reload into daemon mode in `index.ts`

**Files:**
- Modify: `src/index.ts` (daemon section, ~lines 364–465)

- [ ] **Step 1: Add the import at the top of `index.ts`**

After the existing import block (after line 20 `import { checkForUpdate, ... }`), add:

```ts
import { startConfigReloader } from "./config-reloader";
```

- [ ] **Step 2: Make daemon state variables mutable**

In `index.ts`, find the daemon section that starts around line 369:

```ts
const classifier = new Classifier(config.rules);
const watchPaths = expandedWatchPaths(config);
```

Replace with `let` so they can be updated on reload:

```ts
let classifier = new Classifier(config.rules);
const watchPaths = expandedWatchPaths(config);
```

Also find around line 436–438:

```ts
const retryQueue = new RetryQueue(config.safety.max_retries);
const stabilityDelay = config.safety.stability_delay_seconds * 1000;
const retryInterval = config.safety.retry_interval_seconds * 1000;
```

Replace with `let` for the two delay variables:

```ts
const retryQueue = new RetryQueue(config.safety.max_retries);
let stabilityDelay = config.safety.stability_delay_seconds * 1000;
let retryInterval = config.safety.retry_interval_seconds * 1000;
```

- [ ] **Step 3: Capture the watcher handle**

Find the line (around 450):

```ts
startWatching(watchPaths, handleEvent);
```

Replace with:

```ts
const watcher = startWatching(watchPaths, handleEvent);
```

- [ ] **Step 4: Start the config reloader after the watcher**

After `const watcher = startWatching(...)`, add:

```ts
const stopConfigReloader = startConfigReloader({
  configPath,
  currentConfig: config,
  onReload: (newConfig, diff) => {
    // Rebuild classifier with new rules
    classifier = new Classifier(newConfig.rules);

    // Update safety timing — values are closed over in handleEvent and the retry interval,
    // so reassigning here takes effect on the next event/tick naturally.
    stabilityDelay = newConfig.safety.stability_delay_seconds * 1000;
    retryInterval = newConfig.safety.retry_interval_seconds * 1000;

    // Update watched paths
    for (const p of diff.addedPaths) {
      watcher.add(p);
    }
    for (const p of diff.removedPaths) {
      watcher.unwatch(p);
    }
  },
  logFn: log,
});
```

- [ ] **Step 5: Update the `handleEvent` closure to use the mutable `stabilityDelay`**

Find the `createEventHandler` call (around line 439):

```ts
const handleEvent = createEventHandler({
  stabilityDelayMs: stabilityDelay,
```

The `stabilityDelayMs` is passed by value, so changes to `stabilityDelay` won't be picked up. Change to a getter:

Replace:

```ts
const handleEvent = createEventHandler({
  stabilityDelayMs: stabilityDelay,
  hasTempExtensionFn: (path) => hasTempExtension(path, config.safety.ignore_extensions),
  processFile: async (path) => processFile(path),
  existsFn: existsSync,
  accessibleFn: isFileAccessible,
  sleepFn: (ms) => Bun.sleep(ms),
  logFn: log,
  retryQueue,
});
```

With:

```ts
const handleEvent = createEventHandler({
  get stabilityDelayMs() { return stabilityDelay; },
  hasTempExtensionFn: (path) => hasTempExtension(path, config.safety.ignore_extensions),
  processFile: async (path) => processFile(path),
  existsFn: existsSync,
  accessibleFn: isFileAccessible,
  sleepFn: (ms) => Bun.sleep(ms),
  logFn: log,
  retryQueue,
});
```

Also update `processFile` to use the mutable `classifier` (it already closes over `classifier` by reference since we used `let`, so no change needed there — the function reads `classifier.classify(...)` which will automatically see the new instance).

- [ ] **Step 6: Stop the config reloader on SIGINT**

Find the existing SIGINT handler at the bottom of `index.ts`:

```ts
process.on("SIGINT", () => {
  log("info", "Shutting down...");
  process.exit(0);
});
```

Replace with:

```ts
process.on("SIGINT", () => {
  stopConfigReloader();
  watcher.close();
  log("info", "Shutting down...");
  process.exit(0);
});
```

- [ ] **Step 7: Type-check**

```
bunx tsc --noEmit
```

Expected: no errors. If `EventHandlerDeps.stabilityDelayMs` doesn't accept a getter, update the interface in `src/daemon.ts` — no change needed since TypeScript structural typing handles getter/value interchangeably on object literals.

- [ ] **Step 8: Run all tests**

```
bun test
```

Expected: all PASS, no regressions.

- [ ] **Step 9: Commit**

```
git add src/index.ts
git commit -m "feat: wire config hot-reload into daemon mode"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Build and run in dry-run daemon mode**

```
bun run src/index.ts --dry-run
```

Expected output:
```
FileFlow starting...
[DRY-RUN] mode enabled — no files will be moved
Watching: C:\Users\...\Downloads
Watching: C:\Users\...\Desktop
FileFlow daemon running. Press Ctrl+C to stop.
```

- [ ] **Step 2: In another terminal, add a new rule to `fileflow.toml`**

Open `fileflow.toml` and add a new rule at the bottom:

```toml
[[rules]]
name = "TestReload"
type = "extension"
match = [".testreload"]
destination = "C:\\Temp\\TestReload"
```

Save the file.

- [ ] **Step 3: Verify reload log appears within ~1 second**

In the running daemon terminal, you should see:

```
CONFIG_RELOADED — rules=12 watch_paths=2
```

- [ ] **Step 4: Verify invalid config is handled gracefully**

Write invalid TOML into `fileflow.toml` (e.g. append `[[[broken`), save. Expected log:

```
CONFIG_RELOAD_FAILED fileflow.toml (reason: ...)
```

The daemon should keep running. Restore the config — daemon should reload successfully.

- [ ] **Step 5: Press Ctrl+C and verify clean shutdown**

Expected:
```
Shutting down...
```

Process exits cleanly (exit code 0).

---

## Self-Review Checklist

### Spec coverage
- ✅ Config file watched for changes → Task 2 (`startConfigReloader`)
- ✅ 500ms debounce → Task 2 (`setTimeout(fn, 500)`)
- ✅ Rules reloaded → Task 3 (`classifier = new Classifier(newConfig.rules)`)
- ✅ Watch paths diffed and updated → Task 2 (`diffPaths`) + Task 3 (`.add`/`.unwatch`)
- ✅ Safety settings updated → Task 3 (`stabilityDelay`, `retryInterval`)
- ✅ Parse error keeps old config → Task 2 (try/catch, no mutation on error)
- ✅ Log messages → Task 2 (`CONFIG_RELOADED`, `CONFIG_RELOAD_FAILED`)
- ✅ `startWatching` returns handle → Task 1
- ✅ Stop on SIGINT → Task 3
- ✅ Daemon-only (one-shot modes unaffected) → `startConfigReloader` only called in daemon path

### Placeholder scan
None found.

### Type consistency
- `WatcherHandle` defined in Task 1, used in Task 3 as `watcher.add`, `watcher.unwatch`, `watcher.close` ✅
- `ConfigDiff` defined in Task 2, used in Task 3 as `diff.addedPaths`, `diff.removedPaths` ✅
- `startConfigReloader` returns `() => void`, called as `stopConfigReloader()` in Task 3 ✅
