# FileFlow Project Documentation

This document is based on the current Bun/TypeScript codebase.
The repository still contains older Rust planning documents, but the active implementation is described here.

## 1) Project Summary

FileFlow is a Windows-focused file organization daemon.
It watches configured folders (for example Downloads and Desktop), classifies incoming files using ordered rules, and moves them safely to destination folders.

Core goals:
- Avoid moving in-progress or locked files too early
- Keep deterministic classification with first-match-wins behavior
- Prevent data loss during conflicts and cross-drive moves
- Keep reliable, auditable logs

## 2) Tech Stack

- Runtime: Bun
- Language: TypeScript (strict)
- Testing: `bun:test`
- Config parsing: `@iarna/toml`
- Pattern matching: `minimatch`

Dependencies are defined in `package.json`.

## 3) Directory Structure (Important Files)

- `src/index.ts`: CLI entry point, scan-once mode, daemon wiring
- `src/config.ts`: TOML loading, env expansion, config validation
- `src/classifier.ts`: rule-based pattern/extension classification
- `src/mover.ts`: safe moving, duplicate handling, cross-drive fallback
- `src/safety.ts`: temp extension filtering, file accessibility checks, retry queue
- `src/watcher.ts`: recursive watching with `fs.watch`, recursive scan helpers
- `src/daemon.ts`: event handler (dedup + in-flight guard + retry enqueue)
- `src/logger.ts`: logging and numbered log rotation
- `tests/integration.test.ts`: CLI integration coverage

## 4) Runtime Modes and CLI

Supported flags in `src/index.ts`:

- `--config <path>`: config file path (default: `fileflow.toml`)
- `--scan-once`: process existing files once and exit
- `--dry-run`: log actions without moving files
- `--init`: create default config file
- `--install`: register startup task in Windows Task Scheduler
- `--uninstall`: remove startup task
- `--status`: show configuration and runtime status
- `--validate`: validate config, paths, and destination permissions
- `--explain <file>`: explain rule matching for a file
- `--help`, `-h`: show help
- `--version`, `-v`: show version

Examples:

```bash
bun run src/index.ts --init
bun run src/index.ts --scan-once --config fileflow.toml
bun run src/index.ts --scan-once --dry-run --config fileflow.toml
bun run src/index.ts --status --config fileflow.toml
```

## 5) Configuration Model

Config schema (`src/config.ts`):

- `[watch]`
  - `paths: string[]`
- `[safety]`
  - `ignore_extensions: string[]`
  - `stability_delay_seconds: number`
  - `retry_interval_seconds: number`
  - `max_retries: number`
- `[logging]`
  - `path: string`
  - `max_size_mb: number`
  - `rotate: boolean`
- `[notifications]`
  - `enabled: boolean` (reserved for future behavior)
- `[[rules]]`
  - `name: string`
  - `type: "pattern" | "extension"`
  - `match: string[]`
  - `destination: string`

### Environment variable expansion

`expandEnvVars()` resolves `%VAR%` patterns.

Current behavior:
- expansion is applied to watch paths (`expandedWatchPaths`)
- expansion is applied to rule destinations (`loadConfig` mapping)

## 6) Event Pipeline (Daemon)

The daemon flow is centered around `createEventHandler()` in `src/daemon.ts`.

1. Watcher emits an event (`created` or `renamed`)
2. Rapid-fire deduplication is applied (`recentEvents` + stability window)
3. Temp extension files are skipped immediately
4. `inFlightPaths` blocks parallel handling of the same path
5. Stability delay is awaited
6. Existence check confirms file is still present
7. If accessible, `processFile` runs
8. If inaccessible, file is queued for retry
9. On error, event is logged and re-queued
10. `finally` cleanup removes in-flight lock

Retry processing is driven by the interval in `index.ts`:
- `retryQueue.drainReady()`
- ready paths are retried
- failing paths are re-added

## 7) Classification Behavior

`Classifier.classify()` in `src/classifier.ts` processes rules in order.
First matching rule wins.

- `pattern`: `minimatch(..., { nocase: true })`
- `extension`: lowercase extension comparison

If nothing matches, it returns `null` and the file remains in place.

## 8) Move Safety

`moveFile()` in `src/mover.ts` prioritizes data safety:

1. Creates destination directory if missing (`mkdirSync(..., recursive)`)
2. Chooses a collision-free destination via `uniqueDestination()`
3. Uses `activeMoves` to prevent in-process race conditions
4. Tries `renameSync` first (same device)
5. Falls back to `crossDriveMove()` only on `EXDEV`

`crossDriveMove()` steps:
- copy with `copyFileSync`
- verify source and destination size
- remove destination and throw on mismatch
- delete source via `unlinkSync`
- if source delete fails, log duplicate-warning and throw

## 9) Safety and Resilience Layer

`src/safety.ts`:

- `hasTempExtension()`: filters in-progress extensions
- `isFileAccessible()`: two-phase check
  - first `r+` to detect lock/write access
  - fallback to `r` on `EACCES/EPERM` to allow read-only files
- `RetryQueue`
  - stability check using file size
  - accessibility check
  - emits `GAVE UP` warning after max retries

## 10) Logging and Rotation

`src/logger.ts`:

- every log line is also printed to stdout
- file logging is initialized with `initLogger`
- format: `[YYYY-MM-DD HH:mm:ss] LEVEL message`
- numbered rotation cascade:
  - `fileflow.log` -> `fileflow.1.log`
  - existing `.1` -> `.2`, `.2` -> `.3`
  - keeps max 3 rotated files

## 11) Test Strategy and Coverage

Current state: tests are actively maintained and should be re-checked with each release.

Test files:
- `src/config.test.ts`: parsing, env expansion, validation
- `src/classifier.test.ts`: rule matching and order
- `src/mover.test.ts`: dry-run, duplicate naming, cross-drive, race lock
- `src/safety.test.ts`: temp extensions, accessibility, retry queue
- `src/watcher.test.ts`: recursive watch behavior
- `src/daemon.test.ts`: dedup/in-flight/retry behavior
- `src/logger.test.ts`: formatting and rotation scenarios
- `src/scheduler.test.ts`: startup task adapter and command behavior
- `src/status.test.ts`: status output behavior
- `src/validate.test.ts`: validation checks/report output
- `src/explain.test.ts`: explain output and match reasoning
- `tests/integration.test.ts`: CLI integration (`--init`, `--scan-once`, `--dry-run`, `--status`, `--validate`, `--explain`)

Commands:

```bash
bun test
bunx tsc --noEmit
```

## 12) Known Limitations and Notes

- Logger uses module-level mutable state in `src/logger.ts` (intentional trade-off)
- `notifications.enabled` does not yet change runtime behavior
- Retry queue is in-memory and not persisted across restarts
- `fs.watch` event semantics can vary by platform and environment

## 13) Operational Recommendations

- In production, start with `--dry-run --scan-once` to validate rules
- Validate destination write access before enabling daemon mode
- Keep ignore-extension list aligned with your browsers/download tools
- Tune log rotation and log path by disk constraints

## 14) Development Notes

- TypeScript strict mode is enabled (`tsconfig.json`)
- Tests prefer real filesystem interaction over heavy mocking
- Responsibilities are clearly separated across modules

Keep this document updated as the implementation evolves.
