# FileFlow Phase 1 — Design Document

## Decisions

- **Async runtime:** Tokio
- **Architecture:** Monolithic single-loop (event channel + sequential processing)
- **Config env vars:** Expanded at runtime (%VAR% and $VAR patterns)

## Project Structure

```
fileflow/
├── Cargo.toml
├── fileflow.toml          # default config (created via --init)
├── src/
│   ├── main.rs            # CLI parsing (clap), runtime bootstrap
│   ├── config.rs          # TOML parse, env var expansion, validation
│   ├── watcher.rs         # notify watcher setup, event → channel
│   ├── classifier.rs      # rule matching (pattern + extension)
│   ├── mover.rs           # safe file move (lock check, duplicate, atomic)
│   ├── safety.rs          # stability delay, temp extension filter, retry queue
│   └── logger.rs          # file logging, rotation
```

## Event Flow

```
notify event → filter (temp ext?) → stability delay → classify → move
                                         ↓ (locked/unstable)
                                    retry queue → re-check after N sec
```

## Crates

| Crate | Purpose |
|-------|---------|
| `tokio` | Async runtime |
| `notify` | Filesystem watcher (ReadDirectoryChangesW on Windows) |
| `clap` | CLI argument parsing |
| `serde` + `toml` | Config deserialization |
| `globset` | Filename pattern matching |
| `tracing` + `tracing-appender` | Structured logging + file rotation |
| `windows-sys` | File lock check via Windows API |

## Module Details

### watcher.rs
- Uses `notify::RecommendedWatcher` (ReadDirectoryChangesW on Windows)
- Listens for `Create` and `Rename` events
- Sends events to `tokio::sync::mpsc` channel
- Watches all paths from `watch.paths` config (env vars expanded)

### safety.rs
1. **Temp extension filter:** Skip files with extensions in `ignore_extensions`
2. **Stability delay:** Wait `stability_delay_seconds`, check if file size changed
3. **File lock check:** Attempt exclusive access via `CreateFileW` + `FILE_SHARE_NONE`
4. **Retry queue:** `Vec<PendingFile>` re-checked every `retry_interval_seconds`, up to `max_retries`

```rust
struct PendingFile {
    path: PathBuf,
    first_seen: Instant,
    last_size: u64,
    retry_count: u32,
}
```

Rename detection: `.crdownload` → `.pdf` rename enters pipeline as new file with final extension.

### classifier.rs
- Iterates `[[rules]]` in config order (first match wins)
- Two rule types:
  - `pattern`: glob match against filename (case-insensitive)
  - `extension`: lowercase extension lookup in set
- Returns `RuleMatch::Matched { rule_name, destination }` or `RuleMatch::NoMatch`

### mover.rs
1. Create destination dir if missing (`fs::create_dir_all`)
2. Duplicate handling: append `_1`, `_2`, etc. before extension
3. Same drive → `fs::rename` (atomic)
4. Cross-drive → `fs::copy` + `fs::remove_file`
5. Pre-move write permission check on destination

Drive detection via path prefix comparison (`C:\` vs `W:\`).

### logger.rs
- Uses `tracing` + `tracing-appender`
- Format: `[YYYY-MM-DD HH:MM:SS] ACTION details`
- File rotation based on max size config
- Also writes to stdout when running in foreground

## CLI

```
fileflow [OPTIONS]

Options:
  --config <PATH>    Config file path (default: ./fileflow.toml)
  --dry-run          Log actions without moving files
  --scan-once        Process existing files once and exit
  --init             Generate default config file
```

- `--dry-run`: Full pipeline runs but mover only logs with `[DRY-RUN]` prefix
- `--scan-once`: Scan watched folders once, classify and move, then exit
- `--init`: Write default config from PRD to `fileflow.toml`
