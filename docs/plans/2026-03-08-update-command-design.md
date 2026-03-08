# --update Command Design

## Problem

Users who installed FileFlow via the installer have no way to update to a newer release without re-running the full install script. The binary should be able to update itself.

## Constraints

- On Windows, a running `.exe` cannot overwrite or delete itself (EBUSY).
- Windows does allow renaming a running `.exe` within the same directory.
- The binary is ~115MB (Bun-compiled), so downloads take a few seconds on typical connections.

## Design

### Behavior

`fileflow --update` performs a self-update of the binary only. Config, scheduler task, and PATH are untouched. Always targets the latest GitHub release.

### Flow

1. **Resolve install path** — `process.argv[0]` gives the path to the running exe. Resolve it to get the directory.
2. **Check version** — `GET https://api.github.com/repos/theyagizsina/fileflow/releases/latest` to get the latest tag. Compare against the built-in `VERSION` constant. If already up-to-date, print message and exit.
3. **Download** — Fetch `fileflow.exe` from the release assets to `<install-dir>/fileflow.exe.new`.
4. **Rename-aside** — Rename the currently running `fileflow.exe` to `fileflow.exe.old`.
5. **Rename-in** — Rename `fileflow.exe.new` to `fileflow.exe`.
6. **Print success** — Tell the user to restart. The `.old` file will be cleaned up on next run.

### Cleanup on startup

On every startup (before any command processing), check for and delete `fileflow.exe.old` next to the running binary. This is a single `unlinkSync` call wrapped in a try/catch.

### Error handling

- **Network failure during version check**: Print error, exit 1.
- **Network failure during download**: Delete the partial `.new` file, exit 1.
- **Rename failure**: Attempt to restore `.old` back to original name, print error, exit 1.
- **Already up to date**: Print current version, exit 0.

### Module structure

| File | Purpose |
|---|---|
| `src/updater.ts` | `checkForUpdate(currentVersion)`, `performUpdate(exePath)` |
| `src/updater.test.ts` | Unit tests with dependency-injected HTTP and FS operations |
| `src/index.ts` | Add `--update` flag, `.old` cleanup at startup |

### Output

```
$ fileflow --update
Current version: 0.1.0
Checking for updates... v0.2.0 available
Downloading fileflow.exe... done
Replacing binary... done
Updated to v0.2.0. Restart fileflow to use the new version.
```

```
$ fileflow --update
Current version: 0.1.0
Already up to date.
```

### Out of scope

- Config migration
- Scheduler task re-registration
- Version pinning
- Auto-restart
- Rollback beyond the single `.old` file
