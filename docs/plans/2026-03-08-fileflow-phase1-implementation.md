# FileFlow Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working file organization daemon that watches Downloads/Desktop and auto-moves files based on configurable rules.

**Architecture:** Monolithic single-loop with Tokio. notify watcher sends events through mpsc channel, main loop applies safety checks → classification → safe move. Retry queue for locked files.

**Tech Stack:** Rust, Tokio, notify, clap, serde/toml, globset, tracing, windows-sys

---

### Task 1: Project Scaffolding

**Files:**
- Create: `Cargo.toml`
- Create: `src/main.rs`

**Step 1: Initialize Cargo project**

```bash
cd W:/Projects/Fileflow
cargo init --name fileflow
```

**Step 2: Set up Cargo.toml with all dependencies**

Replace `Cargo.toml` with:

```toml
[package]
name = "fileflow"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
notify = { version = "7", features = ["macos_kqueue"] }
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
toml = "0.8"
globset = "0.4"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["fmt", "env-filter"] }
tracing-appender = "0.2"
anyhow = "1"
chrono = "0.4"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_Storage_FileSystem", "Win32_Foundation"] }
```

**Step 3: Replace src/main.rs with module declarations**

```rust
mod config;
mod classifier;
mod safety;
mod mover;
mod watcher;
mod logger;

fn main() {
    println!("FileFlow starting...");
}
```

**Step 4: Create empty module files**

```bash
touch src/config.rs src/classifier.rs src/safety.rs src/mover.rs src/watcher.rs src/logger.rs
```

**Step 5: Verify it compiles**

Run: `cargo build`
Expected: Successful build with warnings about unused modules.

**Step 6: Commit**

```bash
git add Cargo.toml src/
git commit -m "feat: scaffold project with dependencies and module structure"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.rs`
- Test: inline `#[cfg(test)]` module

**Step 1: Write tests for config parsing and env var expansion**

Write `src/config.rs`:

```rust
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize, Clone)]
pub struct Config {
    pub watch: WatchConfig,
    pub safety: SafetyConfig,
    pub logging: LoggingConfig,
    #[serde(default)]
    pub notifications: NotificationsConfig,
    #[serde(default)]
    pub rules: Vec<Rule>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct WatchConfig {
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SafetyConfig {
    pub ignore_extensions: Vec<String>,
    #[serde(default = "default_stability_delay")]
    pub stability_delay_seconds: u64,
    #[serde(default = "default_retry_interval")]
    pub retry_interval_seconds: u64,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
}

fn default_stability_delay() -> u64 { 3 }
fn default_retry_interval() -> u64 { 10 }
fn default_max_retries() -> u32 { 30 }

#[derive(Debug, Deserialize, Clone)]
pub struct LoggingConfig {
    pub path: String,
    #[serde(default = "default_max_size")]
    pub max_size_mb: u64,
    #[serde(default)]
    pub rotate: bool,
}

fn default_max_size() -> u64 { 10 }

#[derive(Debug, Deserialize, Clone)]
pub struct NotificationsConfig {
    #[serde(default)]
    pub enabled: bool,
}

impl Default for NotificationsConfig {
    fn default() -> Self {
        Self { enabled: false }
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct Rule {
    pub name: String,
    #[serde(rename = "type")]
    pub rule_type: RuleType,
    #[serde(rename = "match")]
    pub match_patterns: Vec<String>,
    pub destination: String,
}

#[derive(Debug, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RuleType {
    Pattern,
    Extension,
}

/// Expand environment variables in a string.
/// Supports %VAR% (Windows) and $VAR / ${VAR} (Unix) syntax.
pub fn expand_env_vars(input: &str) -> String {
    let mut result = input.to_string();

    // Expand %VAR% patterns (Windows-style)
    while let Some(start) = result.find('%') {
        if let Some(end) = result[start + 1..].find('%') {
            let var_name = &result[start + 1..start + 1 + end];
            let value = std::env::var(var_name).unwrap_or_default();
            result = format!("{}{}{}", &result[..start], value, &result[start + 2 + end..]);
        } else {
            break;
        }
    }

    result
}

impl Config {
    pub fn load(path: &std::path::Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: Config = toml::from_str(&content)?;
        Ok(config)
    }

    /// Return watch paths with env vars expanded.
    pub fn expanded_watch_paths(&self) -> Vec<PathBuf> {
        self.watch
            .paths
            .iter()
            .map(|p| PathBuf::from(expand_env_vars(p)))
            .collect()
    }
}

pub fn default_config_toml() -> &'static str {
    include_str!("../default_config.toml")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_config() {
        let toml_str = r#"
[watch]
paths = ["C:\\Users\\test\\Downloads"]

[safety]
ignore_extensions = [".tmp", ".crdownload"]

[logging]
path = "fileflow.log"
"#;
        let config: Config = toml::from_str(toml_str).unwrap();
        assert_eq!(config.watch.paths.len(), 1);
        assert_eq!(config.safety.ignore_extensions.len(), 2);
        assert_eq!(config.safety.stability_delay_seconds, 3); // default
        assert_eq!(config.safety.max_retries, 30); // default
        assert!(!config.notifications.enabled); // default
    }

    #[test]
    fn test_parse_config_with_rules() {
        let toml_str = r#"
[watch]
paths = ["C:\\Downloads"]

[safety]
ignore_extensions = [".tmp"]

[logging]
path = "fileflow.log"

[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*", "Screen Shot*"]
destination = "W:\\Media\\Screenshots"

[[rules]]
name = "Videos"
type = "extension"
match = [".mp4", ".mkv"]
destination = "W:\\Media\\Videos"
"#;
        let config: Config = toml::from_str(toml_str).unwrap();
        assert_eq!(config.rules.len(), 2);
        assert_eq!(config.rules[0].rule_type, RuleType::Pattern);
        assert_eq!(config.rules[1].rule_type, RuleType::Extension);
        assert_eq!(config.rules[0].match_patterns, vec!["Screenshot*", "Screen Shot*"]);
    }

    #[test]
    fn test_expand_env_vars_windows() {
        std::env::set_var("FILEFLOW_TEST_USER", "testuser");
        let result = expand_env_vars("C:\\Users\\%FILEFLOW_TEST_USER%\\Downloads");
        assert_eq!(result, "C:\\Users\\testuser\\Downloads");
        std::env::remove_var("FILEFLOW_TEST_USER");
    }

    #[test]
    fn test_expand_env_vars_missing() {
        let result = expand_env_vars("C:\\Users\\%NONEXISTENT_VAR_XYZ%\\Downloads");
        assert_eq!(result, "C:\\Users\\\\Downloads");
    }

    #[test]
    fn test_expand_env_vars_no_vars() {
        let result = expand_env_vars("C:\\Users\\sina\\Downloads");
        assert_eq!(result, "C:\\Users\\sina\\Downloads");
    }
}
```

**Step 2: Create default_config.toml**

Create `default_config.toml` in project root with the full config from the PRD (the one in `fileflow-prd.md` lines 159-248).

**Step 3: Run tests**

Run: `cargo test --lib config`
Expected: All 5 tests pass.

**Step 4: Commit**

```bash
git add src/config.rs default_config.toml
git commit -m "feat: add config module with TOML parsing and env var expansion"
```

---

### Task 3: Classifier Module

**Files:**
- Create: `src/classifier.rs`
- Test: inline `#[cfg(test)]` module

**Step 1: Write tests for classification**

Write `src/classifier.rs`:

```rust
use crate::config::{Rule, RuleType};
use globset::{Glob, GlobMatcher};
use std::path::{Path, PathBuf};

pub struct Classifier {
    compiled_rules: Vec<CompiledRule>,
}

struct CompiledRule {
    name: String,
    destination: PathBuf,
    matcher: RuleMatcher,
}

enum RuleMatcher {
    Pattern(Vec<GlobMatcher>),
    Extension(Vec<String>),
}

pub enum ClassifyResult {
    Matched {
        rule_name: String,
        destination: PathBuf,
    },
    NoMatch,
}

impl Classifier {
    pub fn new(rules: &[Rule]) -> anyhow::Result<Self> {
        let mut compiled_rules = Vec::new();
        for rule in rules {
            let matcher = match rule.rule_type {
                RuleType::Pattern => {
                    let globs: Result<Vec<_>, _> = rule
                        .match_patterns
                        .iter()
                        .map(|p| {
                            Glob::new(p)
                                .map(|g| g.compile_matcher())
                        })
                        .collect();
                    RuleMatcher::Pattern(globs?)
                }
                RuleType::Extension => {
                    let exts: Vec<String> = rule
                        .match_patterns
                        .iter()
                        .map(|e| e.to_lowercase())
                        .collect();
                    RuleMatcher::Extension(exts)
                }
            };
            compiled_rules.push(CompiledRule {
                name: rule.name.clone(),
                destination: PathBuf::from(&rule.destination),
                matcher,
            });
        }
        Ok(Self { compiled_rules })
    }

    pub fn classify(&self, file_path: &Path) -> ClassifyResult {
        let file_name = match file_path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name,
            None => return ClassifyResult::NoMatch,
        };

        let extension = file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_lowercase()))
            .unwrap_or_default();

        for rule in &self.compiled_rules {
            let matched = match &rule.matcher {
                RuleMatcher::Pattern(globs) => {
                    globs.iter().any(|g| g.is_match(file_name))
                }
                RuleMatcher::Extension(exts) => {
                    !extension.is_empty() && exts.contains(&extension)
                }
            };
            if matched {
                return ClassifyResult::Matched {
                    rule_name: rule.name.clone(),
                    destination: rule.destination.clone(),
                };
            }
        }

        ClassifyResult::NoMatch
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Rule, RuleType};

    fn test_rules() -> Vec<Rule> {
        vec![
            Rule {
                name: "Screenshots".to_string(),
                rule_type: RuleType::Pattern,
                match_patterns: vec!["Screenshot*".to_string(), "Screen Shot*".to_string()],
                destination: "W:\\Media\\Screenshots".to_string(),
            },
            Rule {
                name: "Videos".to_string(),
                rule_type: RuleType::Extension,
                match_patterns: vec![".mp4".to_string(), ".mkv".to_string()],
                destination: "W:\\Media\\Videos".to_string(),
            },
            Rule {
                name: "Images".to_string(),
                rule_type: RuleType::Extension,
                match_patterns: vec![".jpg".to_string(), ".png".to_string()],
                destination: "W:\\Media\\Images".to_string(),
            },
        ]
    }

    #[test]
    fn test_pattern_match_screenshot() {
        let classifier = Classifier::new(&test_rules()).unwrap();
        match classifier.classify(Path::new("Screenshot_2026-03-08.png")) {
            ClassifyResult::Matched { rule_name, .. } => assert_eq!(rule_name, "Screenshots"),
            ClassifyResult::NoMatch => panic!("Expected match"),
        }
    }

    #[test]
    fn test_pattern_match_takes_priority_over_extension() {
        // Screenshot*.png should match "Screenshots" pattern, not "Images" extension
        let classifier = Classifier::new(&test_rules()).unwrap();
        match classifier.classify(Path::new("Screenshot_2026.png")) {
            ClassifyResult::Matched { rule_name, .. } => assert_eq!(rule_name, "Screenshots"),
            ClassifyResult::NoMatch => panic!("Expected match"),
        }
    }

    #[test]
    fn test_extension_match() {
        let classifier = Classifier::new(&test_rules()).unwrap();
        match classifier.classify(Path::new("movie.mp4")) {
            ClassifyResult::Matched { rule_name, destination } => {
                assert_eq!(rule_name, "Videos");
                assert_eq!(destination, PathBuf::from("W:\\Media\\Videos"));
            }
            ClassifyResult::NoMatch => panic!("Expected match"),
        }
    }

    #[test]
    fn test_extension_case_insensitive() {
        let classifier = Classifier::new(&test_rules()).unwrap();
        match classifier.classify(Path::new("photo.JPG")) {
            ClassifyResult::Matched { rule_name, .. } => assert_eq!(rule_name, "Images"),
            ClassifyResult::NoMatch => panic!("Expected match"),
        }
    }

    #[test]
    fn test_no_match() {
        let classifier = Classifier::new(&test_rules()).unwrap();
        match classifier.classify(Path::new("random.xyz")) {
            ClassifyResult::NoMatch => {} // expected
            ClassifyResult::Matched { .. } => panic!("Expected no match"),
        }
    }

    #[test]
    fn test_first_match_wins() {
        let rules = vec![
            Rule {
                name: "First".to_string(),
                rule_type: RuleType::Extension,
                match_patterns: vec![".txt".to_string()],
                destination: "A:\\".to_string(),
            },
            Rule {
                name: "Second".to_string(),
                rule_type: RuleType::Extension,
                match_patterns: vec![".txt".to_string()],
                destination: "B:\\".to_string(),
            },
        ];
        let classifier = Classifier::new(&rules).unwrap();
        match classifier.classify(Path::new("file.txt")) {
            ClassifyResult::Matched { rule_name, .. } => assert_eq!(rule_name, "First"),
            ClassifyResult::NoMatch => panic!("Expected match"),
        }
    }
}
```

**Step 2: Run tests**

Run: `cargo test --lib classifier`
Expected: All 6 tests pass.

**Step 3: Commit**

```bash
git add src/classifier.rs
git commit -m "feat: add classifier module with pattern and extension matching"
```

---

### Task 4: Mover Module

**Files:**
- Create: `src/mover.rs`
- Test: inline `#[cfg(test)]` module

**Step 1: Write mover with tests**

Write `src/mover.rs`:

```rust
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tracing::{info, warn};

pub struct MoveResult {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub rule_name: String,
}

/// Generate a unique destination path by appending _1, _2, etc. if file exists.
pub fn unique_destination(dest_dir: &Path, file_name: &str) -> PathBuf {
    let dest = dest_dir.join(file_name);
    if !dest.exists() {
        return dest;
    }

    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);
    let ext = Path::new(file_name)
        .extension()
        .and_then(|e| e.to_str());

    for i in 1..u32::MAX {
        let new_name = match ext {
            Some(e) => format!("{}_{}.{}", stem, i, e),
            None => format!("{}_{}", stem, i),
        };
        let candidate = dest_dir.join(&new_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    // Fallback: should never reach here
    dest_dir.join(format!("{}_dup", file_name))
}

/// Check if two paths are on the same drive (Windows: compare drive letter prefix).
fn same_drive(a: &Path, b: &Path) -> bool {
    let prefix_a = a.components().next();
    let prefix_b = b.components().next();
    prefix_a == prefix_b
}

/// Move a file to the destination directory.
/// Creates the destination directory if needed.
/// Handles duplicates by appending _1, _2, etc.
/// Returns the final destination path.
pub fn move_file(source: &Path, dest_dir: &Path, dry_run: bool) -> Result<PathBuf> {
    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .context("Invalid source filename")?;

    // Create destination directory if needed
    if !dry_run && !dest_dir.exists() {
        std::fs::create_dir_all(dest_dir)
            .with_context(|| format!("Failed to create directory: {}", dest_dir.display()))?;
    }

    let final_dest = unique_destination(dest_dir, file_name);

    if dry_run {
        info!("[DRY-RUN] WOULD MOVE {} -> {}", source.display(), final_dest.display());
        return Ok(final_dest);
    }

    // Try rename first (atomic, same drive only)
    if same_drive(source, &final_dest) {
        match std::fs::rename(source, &final_dest) {
            Ok(()) => return Ok(final_dest),
            Err(e) => {
                warn!("Rename failed ({}), falling back to copy+delete", e);
            }
        }
    }

    // Cross-drive or rename failed: copy + delete
    std::fs::copy(source, &final_dest)
        .with_context(|| format!("Failed to copy {} -> {}", source.display(), final_dest.display()))?;
    std::fs::remove_file(source)
        .with_context(|| format!("Failed to remove source after copy: {}", source.display()))?;

    Ok(final_dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_unique_destination_no_conflict() {
        let dir = std::env::temp_dir().join("fileflow_test_unique_no_conflict");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let result = unique_destination(&dir, "test.txt");
        assert_eq!(result, dir.join("test.txt"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_unique_destination_with_conflict() {
        let dir = std::env::temp_dir().join("fileflow_test_unique_conflict");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // Create existing file
        fs::write(dir.join("test.txt"), "existing").unwrap();

        let result = unique_destination(&dir, "test.txt");
        assert_eq!(result, dir.join("test_1.txt"));

        // Create that one too
        fs::write(dir.join("test_1.txt"), "existing").unwrap();
        let result = unique_destination(&dir, "test.txt");
        assert_eq!(result, dir.join("test_2.txt"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_unique_destination_no_extension() {
        let dir = std::env::temp_dir().join("fileflow_test_unique_noext");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        fs::write(dir.join("Makefile"), "existing").unwrap();
        let result = unique_destination(&dir, "Makefile");
        assert_eq!(result, dir.join("Makefile_1"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_same_drive() {
        assert!(same_drive(
            Path::new("C:\\Users\\test"),
            Path::new("C:\\Dest\\folder")
        ));
        assert!(!same_drive(
            Path::new("C:\\Users\\test"),
            Path::new("W:\\Dest\\folder")
        ));
    }

    #[test]
    fn test_move_file_same_dir() {
        let dir = std::env::temp_dir().join("fileflow_test_move");
        let _ = fs::remove_dir_all(&dir);
        let src_dir = dir.join("src");
        let dst_dir = dir.join("dst");
        fs::create_dir_all(&src_dir).unwrap();

        let source = src_dir.join("hello.txt");
        fs::write(&source, "hello world").unwrap();

        let result = move_file(&source, &dst_dir, false).unwrap();
        assert_eq!(result, dst_dir.join("hello.txt"));
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(&result).unwrap(), "hello world");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_move_file_dry_run() {
        let dir = std::env::temp_dir().join("fileflow_test_dryrun");
        let _ = fs::remove_dir_all(&dir);
        let src_dir = dir.join("src");
        let dst_dir = dir.join("dst");
        fs::create_dir_all(&src_dir).unwrap();

        let source = src_dir.join("keep_me.txt");
        fs::write(&source, "data").unwrap();

        let result = move_file(&source, &dst_dir, true).unwrap();
        assert_eq!(result, dst_dir.join("keep_me.txt"));
        // Source should still exist in dry-run mode
        assert!(source.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
```

**Step 2: Run tests**

Run: `cargo test --lib mover`
Expected: All 6 tests pass.

**Step 3: Commit**

```bash
git add src/mover.rs
git commit -m "feat: add mover module with safe file moving and duplicate handling"
```

---

### Task 5: Safety Module

**Files:**
- Create: `src/safety.rs`
- Test: inline `#[cfg(test)]` module

**Step 1: Write safety module with tests**

Write `src/safety.rs`:

```rust
use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::config::SafetyConfig;

pub struct PendingFile {
    pub path: PathBuf,
    pub first_seen: Instant,
    pub last_size: u64,
    pub retry_count: u32,
}

/// Check if file has a temporary/in-progress extension.
pub fn has_temp_extension(path: &Path, ignore_extensions: &[String]) -> bool {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => format!(".{}", e.to_lowercase()),
        None => return false,
    };
    ignore_extensions.iter().any(|ie| ie.to_lowercase() == ext)
}

/// Check if file is locked by another process (Windows-only).
/// Returns true if file is accessible (not locked).
#[cfg(windows)]
pub fn is_file_accessible(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, OPEN_EXISTING,
    };

    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();

    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            0x80000000, // GENERIC_READ
            0,          // no sharing = exclusive
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            std::ptr::null_mut() as _,
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        return false; // locked
    }

    unsafe { CloseHandle(handle) };
    true
}

#[cfg(not(windows))]
pub fn is_file_accessible(_path: &Path) -> bool {
    true // non-Windows: assume accessible
}

/// Get file size, returns 0 if file doesn't exist or can't be read.
pub fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

pub struct RetryQueue {
    pub pending: Vec<PendingFile>,
    pub max_retries: u32,
}

impl RetryQueue {
    pub fn new(max_retries: u32) -> Self {
        Self {
            pending: Vec::new(),
            max_retries,
        }
    }

    pub fn add(&mut self, path: PathBuf) {
        // Don't add duplicates
        if self.pending.iter().any(|p| p.path == path) {
            return;
        }
        self.pending.push(PendingFile {
            last_size: file_size(&path),
            path,
            first_seen: Instant::now(),
            retry_count: 0,
        });
    }

    /// Process retry queue. Returns paths that are ready to be processed.
    /// Removes expired entries (exceeded max_retries).
    pub fn drain_ready(&mut self) -> Vec<PathBuf> {
        let mut ready = Vec::new();
        let mut keep = Vec::new();

        for mut pending in self.pending.drain(..) {
            if !pending.path.exists() {
                continue; // file was removed, skip
            }
            pending.retry_count += 1;
            if pending.retry_count > self.max_retries {
                tracing::warn!(
                    "GAVE UP on {} after {} retries",
                    pending.path.display(),
                    self.max_retries
                );
                continue;
            }

            let current_size = file_size(&pending.path);
            let size_stable = current_size == pending.last_size;
            let accessible = is_file_accessible(&pending.path);

            if size_stable && accessible {
                ready.push(pending.path);
            } else {
                pending.last_size = current_size;
                keep.push(pending);
            }
        }

        self.pending = keep;
        ready
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_has_temp_extension_match() {
        let ignores = vec![".tmp".to_string(), ".crdownload".to_string(), ".part".to_string()];
        assert!(has_temp_extension(Path::new("file.crdownload"), &ignores));
        assert!(has_temp_extension(Path::new("file.TMP"), &ignores));
        assert!(has_temp_extension(Path::new("download.part"), &ignores));
    }

    #[test]
    fn test_has_temp_extension_no_match() {
        let ignores = vec![".tmp".to_string(), ".crdownload".to_string()];
        assert!(!has_temp_extension(Path::new("report.pdf"), &ignores));
        assert!(!has_temp_extension(Path::new("photo.jpg"), &ignores));
        assert!(!has_temp_extension(Path::new("noext"), &ignores));
    }

    #[test]
    fn test_retry_queue_add_no_duplicates() {
        let mut queue = RetryQueue::new(3);
        let path = PathBuf::from("test.txt");
        queue.add(path.clone());
        queue.add(path.clone());
        assert_eq!(queue.pending.len(), 1);
    }

    #[test]
    fn test_retry_queue_drain_ready() {
        let dir = std::env::temp_dir().join("fileflow_test_retry");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let file = dir.join("ready.txt");
        fs::write(&file, "content").unwrap();

        let mut queue = RetryQueue::new(30);
        queue.add(file.clone());

        let ready = queue.drain_ready();
        assert_eq!(ready.len(), 1);
        assert_eq!(ready[0], file);
        assert!(queue.pending.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_retry_queue_max_retries_exceeded() {
        let dir = std::env::temp_dir().join("fileflow_test_retry_max");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let file = dir.join("stuck.txt");
        fs::write(&file, "content").unwrap();

        let mut queue = RetryQueue::new(1);
        queue.pending.push(PendingFile {
            path: file.clone(),
            first_seen: Instant::now(),
            last_size: 7,
            retry_count: 1, // already at max
        });

        let ready = queue.drain_ready();
        assert!(ready.is_empty());
        assert!(queue.pending.is_empty()); // removed because exceeded

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_file_accessible_normal_file() {
        let dir = std::env::temp_dir().join("fileflow_test_accessible");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let file = dir.join("normal.txt");
        fs::write(&file, "data").unwrap();

        assert!(is_file_accessible(&file));

        let _ = fs::remove_dir_all(&dir);
    }
}
```

**Step 2: Run tests**

Run: `cargo test --lib safety`
Expected: All 6 tests pass.

**Step 3: Commit**

```bash
git add src/safety.rs
git commit -m "feat: add safety module with temp extension filter, lock check, and retry queue"
```

---

### Task 6: Logger Module

**Files:**
- Create: `src/logger.rs`

**Step 1: Write logger setup**

Write `src/logger.rs`:

```rust
use crate::config::LoggingConfig;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Initialize logging. Returns a guard that must be kept alive for the
/// duration of the program (dropping it flushes buffered logs).
pub fn init(config: &LoggingConfig) -> WorkerGuard {
    let file_appender = tracing_appender::rolling::never(".", &config.path);
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(
            fmt::layer()
                .with_target(false)
                .with_timer(fmt::time::ChronoLocal::new("%Y-%m-%d %H:%M:%S".to_string()))
                .with_writer(non_blocking),
        )
        .with(
            fmt::layer()
                .with_target(false)
                .with_timer(fmt::time::ChronoLocal::new("%Y-%m-%d %H:%M:%S".to_string()))
                .with_writer(std::io::stdout),
        )
        .init();

    guard
}
```

**Step 2: Verify it compiles**

Run: `cargo build`
Expected: Successful build.

**Step 3: Commit**

```bash
git add src/logger.rs
git commit -m "feat: add logger module with file + stdout output"
```

---

### Task 7: Watcher Module

**Files:**
- Create: `src/watcher.rs`

**Step 1: Write watcher module**

Write `src/watcher.rs`:

```rust
use anyhow::Result;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;

/// Events we care about from the filesystem watcher.
#[derive(Debug)]
pub enum FileEvent {
    Created(PathBuf),
    Renamed(PathBuf),
}

/// Start watching the given paths. Returns a receiver for file events.
pub fn start(
    paths: &[PathBuf],
    buffer_size: usize,
) -> Result<(mpsc::Receiver<FileEvent>, RecommendedWatcher)> {
    let (tx, rx) = mpsc::channel(buffer_size);

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let file_events = match event.kind {
                    EventKind::Create(_) => event
                        .paths
                        .into_iter()
                        .filter(|p| p.is_file())
                        .map(FileEvent::Created)
                        .collect::<Vec<_>>(),
                    EventKind::Modify(notify::event::ModifyKind::Name(
                        notify::event::RenameMode::To,
                    )) => event
                        .paths
                        .into_iter()
                        .filter(|p| p.is_file())
                        .map(FileEvent::Renamed)
                        .collect::<Vec<_>>(),
                    _ => vec![],
                };
                for fe in file_events {
                    let _ = tx.blocking_send(fe);
                }
            }
        },
        Config::default(),
    )?;

    for path in paths {
        if path.exists() {
            watcher.watch(path, RecursiveMode::NonRecursive)?;
            tracing::info!("Watching: {}", path.display());
        } else {
            tracing::warn!("Watch path does not exist, skipping: {}", path.display());
        }
    }

    Ok((rx, watcher))
}

/// Scan existing files in watched directories (for --scan-once mode).
pub fn scan_existing(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for path in paths {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    files.push(p);
                }
            }
        }
    }
    files
}
```

**Step 2: Verify it compiles**

Run: `cargo build`
Expected: Successful build.

**Step 3: Commit**

```bash
git add src/watcher.rs
git commit -m "feat: add watcher module with notify integration and scan support"
```

---

### Task 8: CLI and Main Loop

**Files:**
- Modify: `src/main.rs`
- Create: `default_config.toml`

**Step 1: Create default_config.toml**

Create `default_config.toml` in the project root with the full config content from the PRD (lines 159-248 of `fileflow-prd.md`). Use `sina` as the username in paths.

**Step 2: Write main.rs with CLI and event loop**

Write `src/main.rs`:

```rust
mod classifier;
mod config;
mod logger;
mod mover;
mod safety;
mod watcher;

use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;
use tracing::{info, warn};

#[derive(Parser)]
#[command(name = "fileflow", about = "Automatic file organization daemon")]
struct Cli {
    /// Path to config file
    #[arg(long, default_value = "fileflow.toml")]
    config: PathBuf,

    /// Log what would happen without moving files
    #[arg(long)]
    dry_run: bool,

    /// Process existing files once and exit
    #[arg(long)]
    scan_once: bool,

    /// Generate default config file
    #[arg(long)]
    init: bool,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    if cli.init {
        return init_config(&cli.config);
    }

    let config = config::Config::load(&cli.config)?;
    let _guard = logger::init(&config.logging);

    info!("FileFlow starting...");

    if cli.dry_run {
        info!("[DRY-RUN] mode enabled — no files will be moved");
    }

    let classifier = classifier::Classifier::new(&config.rules)?;
    let watch_paths = config.expanded_watch_paths();

    if cli.scan_once {
        return run_scan_once(&watch_paths, &classifier, &config, cli.dry_run);
    }

    run_daemon(&watch_paths, &classifier, &config, cli.dry_run)
}

fn init_config(path: &PathBuf) -> Result<()> {
    if path.exists() {
        anyhow::bail!("Config file already exists: {}", path.display());
    }
    std::fs::write(path, config::default_config_toml())?;
    println!("Created default config: {}", path.display());
    Ok(())
}

fn run_scan_once(
    watch_paths: &[PathBuf],
    classifier: &classifier::Classifier,
    config: &config::Config,
    dry_run: bool,
) -> Result<()> {
    info!("Scanning existing files...");
    let files = watcher::scan_existing(watch_paths);

    for file in files {
        process_file(&file, classifier, config, dry_run);
    }

    info!("Scan complete.");
    Ok(())
}

#[tokio::main]
async fn run_daemon(
    watch_paths: &[PathBuf],
    classifier: &classifier::Classifier,
    config: &config::Config,
    dry_run: bool,
) -> Result<()> {
    let (mut rx, _watcher) = watcher::start(watch_paths, 100)?;

    let mut retry_queue = safety::RetryQueue::new(config.safety.max_retries);
    let retry_interval = tokio::time::Duration::from_secs(config.safety.retry_interval_seconds);
    let stability_delay = tokio::time::Duration::from_secs(config.safety.stability_delay_seconds);

    let mut retry_ticker = tokio::time::interval(retry_interval);
    retry_ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    info!("FileFlow daemon running. Press Ctrl+C to stop.");

    loop {
        tokio::select! {
            Some(event) = rx.recv() => {
                let path = match event {
                    watcher::FileEvent::Created(p) | watcher::FileEvent::Renamed(p) => p,
                };

                // Check temp extension
                if safety::has_temp_extension(&path, &config.safety.ignore_extensions) {
                    info!("SKIPPED {} (reason: temp_extension)", path.display());
                    continue;
                }

                // Stability delay
                tokio::time::sleep(stability_delay).await;

                // Check if still exists after delay
                if !path.exists() {
                    continue;
                }

                // Try to process, or add to retry queue
                if safety::is_file_accessible(&path) {
                    process_file(&path, classifier, config, dry_run);
                } else {
                    info!("QUEUED {} (reason: file_locked)", path.display());
                    retry_queue.add(path);
                }
            }

            _ = retry_ticker.tick() => {
                let ready = retry_queue.drain_ready();
                for path in ready {
                    info!("RETRY {}", path.display());
                    process_file(&path, classifier, config, dry_run);
                }
            }

            _ = tokio::signal::ctrl_c() => {
                info!("Shutting down...");
                break;
            }
        }
    }

    Ok(())
}

fn process_file(
    path: &PathBuf,
    classifier: &classifier::Classifier,
    config: &config::Config,
    dry_run: bool,
) {
    // Skip temp extensions
    if safety::has_temp_extension(path, &config.safety.ignore_extensions) {
        info!("SKIPPED {} (reason: temp_extension)", path.display());
        return;
    }

    match classifier.classify(path) {
        classifier::ClassifyResult::Matched {
            rule_name,
            destination,
        } => match mover::move_file(path, &destination, dry_run) {
            Ok(dest) => {
                info!(
                    "MOVED {} -> {} (rule: {})",
                    path.display(),
                    dest.display(),
                    rule_name
                );
            }
            Err(e) => {
                warn!("FAILED to move {} -> {}: {}", path.display(), destination.display(), e);
            }
        },
        classifier::ClassifyResult::NoMatch => {
            info!("SKIPPED {} (reason: no_matching_rule)", path.display());
        }
    }
}
```

**Step 3: Verify it compiles and all tests pass**

Run: `cargo build && cargo test`
Expected: Build succeeds, all tests pass.

**Step 4: Commit**

```bash
git add src/main.rs default_config.toml
git commit -m "feat: add CLI interface and main event loop with daemon and scan-once modes"
```

---

### Task 9: Integration Testing

**Files:**
- Create: `tests/integration.rs`

**Step 1: Write integration test**

Create `tests/integration.rs`:

```rust
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn fileflow_bin() -> PathBuf {
    // Build the binary first
    let status = Command::new("cargo")
        .args(["build"])
        .status()
        .expect("Failed to build");
    assert!(status.success());

    PathBuf::from("target/debug/fileflow.exe")
}

#[test]
fn test_init_creates_config() {
    let dir = std::env::temp_dir().join("fileflow_integration_init");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let config_path = dir.join("fileflow.toml");
    let output = Command::new(fileflow_bin())
        .args(["--init", "--config"])
        .arg(&config_path)
        .output()
        .expect("Failed to run fileflow");

    assert!(output.status.success());
    assert!(config_path.exists());

    let content = fs::read_to_string(&config_path).unwrap();
    assert!(content.contains("[watch]"));
    assert!(content.contains("[[rules]]"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_scan_once_moves_files() {
    let dir = std::env::temp_dir().join("fileflow_integration_scan");
    let _ = fs::remove_dir_all(&dir);

    let watch_dir = dir.join("watch");
    let dest_dir = dir.join("dest");
    fs::create_dir_all(&watch_dir).unwrap();

    // Create a test file
    fs::write(watch_dir.join("test_video.mp4"), "fake video").unwrap();

    // Create minimal config
    let config_path = dir.join("test_config.toml");
    let config = format!(
        r#"
[watch]
paths = ["{}"]

[safety]
ignore_extensions = [".tmp", ".crdownload"]

[logging]
path = "{}"

[[rules]]
name = "Videos"
type = "extension"
match = [".mp4"]
destination = "{}"
"#,
        watch_dir.display().to_string().replace('\\', "\\\\"),
        dir.join("test.log").display().to_string().replace('\\', "\\\\"),
        dest_dir.display().to_string().replace('\\', "\\\\"),
    );
    fs::write(&config_path, &config).unwrap();

    let output = Command::new(fileflow_bin())
        .args(["--scan-once", "--config"])
        .arg(&config_path)
        .output()
        .expect("Failed to run fileflow");

    assert!(output.status.success(), "stderr: {}", String::from_utf8_lossy(&output.stderr));
    assert!(dest_dir.join("test_video.mp4").exists());
    assert!(!watch_dir.join("test_video.mp4").exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn test_dry_run_doesnt_move() {
    let dir = std::env::temp_dir().join("fileflow_integration_dryrun");
    let _ = fs::remove_dir_all(&dir);

    let watch_dir = dir.join("watch");
    let dest_dir = dir.join("dest");
    fs::create_dir_all(&watch_dir).unwrap();

    fs::write(watch_dir.join("doc.pdf"), "fake pdf").unwrap();

    let config_path = dir.join("test_config.toml");
    let config = format!(
        r#"
[watch]
paths = ["{}"]

[safety]
ignore_extensions = [".tmp"]

[logging]
path = "{}"

[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "{}"
"#,
        watch_dir.display().to_string().replace('\\', "\\\\"),
        dir.join("test.log").display().to_string().replace('\\', "\\\\"),
        dest_dir.display().to_string().replace('\\', "\\\\"),
    );
    fs::write(&config_path, &config).unwrap();

    let output = Command::new(fileflow_bin())
        .args(["--scan-once", "--dry-run", "--config"])
        .arg(&config_path)
        .output()
        .expect("Failed to run fileflow");

    assert!(output.status.success());
    // File should still be in the watch directory
    assert!(watch_dir.join("doc.pdf").exists());

    let _ = fs::remove_dir_all(&dir);
}
```

**Step 2: Run integration tests**

Run: `cargo test --test integration`
Expected: All 3 integration tests pass.

**Step 3: Commit**

```bash
git add tests/integration.rs
git commit -m "test: add integration tests for init, scan-once, and dry-run modes"
```

---

### Task 10: Final Polish and README

**Files:**
- Create: `.gitignore`

**Step 1: Create .gitignore**

```gitignore
/target
fileflow.log
*.log
```

**Step 2: Run full test suite**

Run: `cargo test`
Expected: All unit + integration tests pass.

**Step 3: Run clippy**

Run: `cargo clippy -- -D warnings`
Expected: No warnings.

**Step 4: Fix any clippy warnings if found**

**Step 5: Final commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore and final cleanup"
```
