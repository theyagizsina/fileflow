# Config Hot-Reload — Design Spec

**Date:** 2026-04-01  
**Status:** Approved  
**Scope:** Daemon mode only

---

## Problem

When FileFlow runs as a daemon, any change to `fileflow.toml` requires a manual restart to take effect. If FileFlow is registered as a Windows startup task, restarting is especially inconvenient. Users should be able to edit their config (add rules, change destinations, add watch paths) and have the daemon pick up changes automatically.

---

## Solution

Watch `fileflow.toml` for filesystem changes. On change, reload and validate the config, diff the watch paths, update in-memory state, and continue without restarting.

---

## Architecture

### New module: `src/config-reloader.ts`

Encapsulates all hot-reload logic. `index.ts` stays clean — it only wires up the callback.

```
fileflow.toml  ──(chokidar change event)──▶  config-reloader.ts
                                                  │
                                          loadConfig() + validate
                                                  │
                                          diff watch paths
                                                  │
                                          onReload(newConfig, diff)
                                                  │
                                    ┌─────────────┴──────────────┐
                                    ▼                            ▼
                             rebuild Classifier         update watcher
                             update safety settings     (add/remove paths)
```

### Public interface

```ts
interface ConfigDiff {
  addedPaths: string[];
  removedPaths: string[];
}

interface ConfigReloaderOptions {
  configPath: string;
  currentConfig: Config;
  onReload: (newConfig: Config, diff: ConfigDiff) => void;
  logFn: (level: string, msg: string) => void;
}

function startConfigReloader(opts: ConfigReloaderOptions): () => void;
// returns: stop() — closes the file watcher
```

---

## Behaviour

### Debounce

Editors emit multiple change events on a single save. A **500ms debounce** is applied: the reload fires 500ms after the last observed change event.

### Successful reload

1. Parse `fileflow.toml` with `loadConfig()`
2. Expand env vars in watch paths
3. Diff old vs new watch paths
4. Call `onReload(newConfig, diff)`
5. Log: `CONFIG_RELOADED — rules=11 watch_paths=2`
6. If watch paths changed, additionally log:
   `CONFIG_RELOAD watch paths changed: +C:\NewFolder, -C:\OldFolder`

### Failed reload (parse/validation error)

- Old config remains active, daemon keeps running
- Log: `CONFIG_RELOAD_FAILED fileflow.toml (reason: <error message>)`
- No state is mutated

### What gets updated on reload

| Setting | Updated? |
|---|---|
| Rules | ✅ Yes — Classifier rebuilt |
| Watch paths | ✅ Yes — new paths subscribed, removed paths unwatched |
| Safety settings | ✅ Yes — stability delay, retry interval, max retries |
| Log settings | ❌ No — logger is initialised once at startup |
| Notifications | ❌ No — not implemented yet |

### What is NOT affected

- In-flight files currently in the stability delay window complete with the old config
- Retry queue entries are not affected (they process with whatever config is current at retry time)
- `--scan-once`, `--dry-run` (one-shot modes) do not activate hot-reload

---

## Watcher changes

`startWatching()` in `watcher.ts` currently returns `void`. It must be updated to return the chokidar watcher instance so that `index.ts` can call `.add(path)` and `.unwatch(path)` when the config reloads with different watch paths.

```ts
// Before
function startWatching(paths: string[], handler: (event: FileEvent) => void): void

// After
function startWatching(paths: string[], handler: (event: FileEvent) => void): FSWatcher
```

---

## index.ts wiring (daemon mode only)

```ts
// After daemon starts:
const stop = startConfigReloader({
  configPath,
  currentConfig: config,
  onReload: (newConfig, diff) => {
    // 1. Rebuild classifier
    classifier = new Classifier(newConfig.rules);

    // 2. Update safety settings
    // stabilityDelay is read per-event so updating the variable is sufficient.
    // retryInterval is used by setInterval which is already running; the new
    // value takes effect on the next tick naturally since the variable is closed over.
    stabilityDelay = newConfig.safety.stability_delay_seconds * 1000;
    retryInterval  = newConfig.safety.retry_interval_seconds * 1000;

    // 3. Update watcher
    for (const p of diff.addedPaths)   watcher.add(p);
    for (const p of diff.removedPaths) watcher.unwatch(p);
  },
  logFn: log,
});

process.on('SIGINT', () => {
  stop();
  log('info', 'Shutting down...');
  process.exit(0);
});
```

---

## Error handling

| Scenario | Behaviour |
|---|---|
| TOML syntax error | Keep old config, log `CONFIG_RELOAD_FAILED` |
| Validation error (missing field) | Keep old config, log `CONFIG_RELOAD_FAILED` |
| New watch path doesn't exist on disk | Watcher subscribes anyway (chokidar tolerates missing dirs); validate warns but does not block |
| Config file deleted | Ignore — keep running with last valid config |

---

## Testing

- Unit test `startConfigReloader`: mock filesystem change, assert `onReload` called with correct diff
- Test debounce: rapid change events → single reload
- Test failed parse: bad TOML → `onReload` not called, old config preserved
- Integration: `startWatching` returns FSWatcher, `.add()` / `.unwatch()` callable
- Existing tests must not regress

---

## Files changed

| File | Change |
|---|---|
| `src/config-reloader.ts` | New — hot-reload module |
| `src/config-reloader.test.ts` | New — unit tests |
| `src/watcher.ts` | Return `FSWatcher` from `startWatching` |
| `src/watcher.test.ts` | Update tests for new return type |
| `src/index.ts` | Wire `startConfigReloader` in daemon mode |

---

## Non-goals

- No GUI or CLI command to trigger reload manually
- No reload of log settings (requires logger re-init)
- No config file creation if deleted
- No notification to user beyond log output
