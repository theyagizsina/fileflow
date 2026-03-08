# FileFlow

Automatic file organizer for Windows.

FileFlow watches folders like `Downloads` and `Desktop`, classifies files with ordered rules, and moves them to the right destination safely.

It is designed for people who want clean folders without manual drag-and-drop work.

## Why FileFlow?

If your `Downloads` folder turns into a pile every week, FileFlow helps by:

- monitoring your chosen folders continuously
- skipping in-progress downloads (`.crdownload`, `.part`, etc.)
- matching files with deterministic rules (first match wins)
- moving files safely with duplicate protection and cross-drive fallback
- keeping an auditable log of every action

## How It Works

1. A file appears in a watched folder.
2. FileFlow waits for stability and checks file accessibility.
3. Rules are evaluated from top to bottom.
4. First matching rule decides the destination.
5. File is moved (or only logged in `--dry-run` mode).

If no rule matches, the file stays in place.

## Current Status

- Runtime: Bun
- Language: TypeScript (strict)
- Platform focus: Windows
- Interface: CLI (`fileflow`)

## Quick Start (Local Development)

### 1) Requirements

- Windows
- [Bun](https://bun.sh/) installed

### 2) Install dependencies

```bash
bun install
```

### 3) Generate a default config

```bash
bun run src/index.ts --init
```

This creates `fileflow.toml` in your current directory.

### 4) Validate your setup

```bash
bun run src/index.ts --validate --config fileflow.toml
```

### 5) Run a safe trial

```bash
bun run src/index.ts --scan-once --dry-run --config fileflow.toml
```

### 6) Run daemon mode

```bash
bun run src/index.ts --config fileflow.toml
```

## Release Installer (Windows)

For release-based install/uninstall scripts, see `docs/INSTALL.md`.

The installer can:

- download `fileflow.exe` from GitHub Releases
- generate user-specific config
- validate configuration
- register startup task via Task Scheduler

## Configuration

Config format is TOML. Main sections:

- `[watch]` - folders to monitor
- `[safety]` - temp extensions, delays, retry settings
- `[logging]` - log path, max size, rotation
- `[[rules]]` - ordered classification rules
- `[projects]` - project creation settings (see [Project Creator](docs/project-creator.md))

Default config template: `default_config.toml`

Rules are deterministic:

- top-to-bottom order
- first match wins
- unmatched files are not moved

### Example rule

```toml
[[rules]]
name = "Documents"
type = "extension"
match = [".pdf", ".docx", ".xlsx"]
destination = "%USERPROFILE%\\FileFlow\\Downloads\\Documents"
```

## CLI

```text
Usage: fileflow [options]
       fileflow create <name> [options]

Commands:
  create <name>     Create a new project under projects.root

Options:
  --config <path>   Config file path (default: fileflow.toml)
  --scan-once       Scan existing files and exit
  --dry-run         Show what would be moved without moving
  --init            Create default config file
  --install         Register as startup task (Task Scheduler)
  --uninstall       Remove startup task
  --status          Show current configuration and status
  --validate        Validate config, paths, and permissions
  --explain <file>  Show which rule matches a file and why
  --yes, -y         Auto-confirm shell actions in create
  --help, -h        Show help
  --version, -v     Show version
```

For details on the create command and blueprint configuration, see [Project Creator docs](docs/project-creator.md).

## Safety Guarantees

FileFlow prioritizes not losing files:

- ignores temporary download extensions
- waits for file stability before processing
- checks file accessibility before moving
- uses unique naming when destination already contains a file
- uses copy+verify+delete fallback for cross-drive moves

## Logging

Logs are written to configured path and stdout.

Rotation keeps numbered log files (up to 3 rotated files).

## Project Structure

- `src/index.ts` - CLI entry point and runtime modes
- `src/config.ts` - TOML load + validation + env expansion
- `src/classifier.ts` - rule matching logic
- `src/mover.ts` - safe move operations
- `src/safety.ts` - lock/stability/retry logic
- `src/watcher.ts` - file watch + scan helpers
- `src/daemon.ts` - event pipeline and retry integration
- `src/logger.ts` - logging + rotation
- `src/blueprints.ts` - blueprint JSON loader + validation
- `src/creator.ts` - project creation flow engine
- `project-blueprints.schema.json` - JSON Schema for blueprint config

## Development

Run tests:

```bash
bun test
```

Type-check:

```bash
bunx tsc --noEmit
```

## Known Limitations

- `notifications.enabled` is reserved and not active yet
- retry queue is in-memory (not persisted across restarts)
- file watch semantics may vary by environment

## Contributing

Contributions are welcome.

If you want to contribute, start with:

1. Open an issue describing the problem or proposal.
2. Keep changes scoped and add/update tests.
3. Run `bun test` and `bunx tsc --noEmit` before opening a PR.

## License

Licensed under the GNU Affero General Public License v3.0 (`AGPL-3.0`). See `LICENSE`.
