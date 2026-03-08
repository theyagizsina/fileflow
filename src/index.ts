import { parseArgs } from "util";
import { existsSync, writeFileSync } from "fs";
import { resolve } from "path";
import { loadConfig, expandedWatchPaths, defaultConfigToml } from "./config";
import { Classifier } from "./classifier";
import { hasTempExtension, isFileAccessible, RetryQueue } from "./safety";
import { moveFile } from "./mover";
import { initLogger, log } from "./logger";
import { startWatching, scanExisting } from "./watcher";
import { createEventHandler } from "./daemon";
import { installStartupTask, uninstallStartupTask, isInstalled, createSchtasksAdapter } from "./scheduler";
import { getStatus } from "./status";

const VERSION = "0.1.0";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: "string", default: "fileflow.toml" },
    "dry-run": { type: "boolean", default: false },
    "scan-once": { type: "boolean", default: false },
    init: { type: "boolean", default: false },
    install: { type: "boolean", default: false },
    uninstall: { type: "boolean", default: false },
    status: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
});

if (values.version) {
  console.log(`fileflow ${VERSION}`);
  process.exit(0);
}

if (values.help) {
  console.log(`fileflow ${VERSION} — automatic file organizer daemon

Usage: fileflow [options]

Options:
  --config <path>   Config file path (default: fileflow.toml)
  --scan-once       Scan existing files and exit
  --dry-run         Show what would be moved without moving
  --init            Create default config file
  --install         Register as startup task (Task Scheduler)
  --uninstall       Remove startup task
  --status          Show current configuration and status
  --help, -h        Show this help message
  --version, -v     Show version number`);
  process.exit(0);
}

const configPath = resolve(values.config!);
const dryRun = values["dry-run"]!;
const scanOnce = values["scan-once"]!;
const init = values.init!;

if (init) {
  if (existsSync(configPath)) {
    console.error(`Config file already exists: ${configPath}`);
    process.exit(1);
  }
  writeFileSync(configPath, defaultConfigToml());
  console.log(`Created default config: ${configPath}`);
  process.exit(0);
}

if (values.install) {
  const exePath = resolve(process.argv[0]!);
  const adapter = createSchtasksAdapter();
  try {
    const msg = installStartupTask({ exePath, configPath, adapter });
    console.log(msg);
    process.exit(0);
  } catch (e) {
    console.error(`Failed to install startup task: ${e}`);
    process.exit(1);
  }
}

if (values.uninstall) {
  const adapter = createSchtasksAdapter();
  try {
    const msg = uninstallStartupTask({ adapter });
    console.log(msg);
    process.exit(0);
  } catch (e) {
    console.error(`Failed to uninstall startup task: ${e}`);
    process.exit(1);
  }
}

if (!existsSync(configPath)) {
  console.error(`Config file not found: ${configPath}`);
  console.error(`Run with --init to create a default config.`);
  process.exit(1);
}

const config = loadConfig(configPath);

if (values.status) {
  const adapter = createSchtasksAdapter();
  const watchPaths = expandedWatchPaths(config);
  const output = getStatus({
    configPath,
    watchPaths,
    logPath: config.logging.path,
    rulesCount: config.rules.length,
    dryRun,
    isSchedulerInstalled: () => isInstalled({ adapter }),
  });
  console.log(output);
  process.exit(0);
}

initLogger(config.logging);

log("info", "FileFlow starting...");
if (dryRun) log("info", "[DRY-RUN] mode enabled — no files will be moved");

const classifier = new Classifier(config.rules);
const watchPaths = expandedWatchPaths(config);

function processFile(filePath: string): void {
  if (hasTempExtension(filePath, config.safety.ignore_extensions)) {
    log("info", `SKIPPED ${filePath} (reason: temp_extension)`);
    return;
  }

  const result = classifier.classify(filePath);
  if (!result) {
    log("info", `SKIPPED ${filePath} (reason: no_matching_rule)`);
    return;
  }

  try {
    const dest = moveFile(filePath, result.destination, dryRun);
    log("info", `MOVED ${filePath} -> ${dest} (rule: ${result.ruleName})`);
  } catch (e) {
    log("error", `FAILED to move ${filePath} -> ${result.destination}: ${e}`);
    throw e;
  }
}

if (scanOnce) {
  log("info", "Scanning existing files...");
  const scanStats = { errors: 0 };
  const summary = { found: 0, matched: 0, skipped: 0 };
  const files = scanExisting(watchPaths, scanStats);
  summary.found = files.length;
  for (const file of files) {
    if (hasTempExtension(file, config.safety.ignore_extensions)) {
      log("info", `SKIPPED ${file} (reason: temp_extension)`);
      summary.skipped++;
      continue;
    }

    const result = classifier.classify(file);
    if (!result) {
      log("info", `SKIPPED ${file} (reason: no_matching_rule)`);
      summary.skipped++;
      continue;
    }

    try {
      const dest = moveFile(file, result.destination, dryRun);
      if (dryRun) {
        log("info", `MATCHED ${file} -> ${dest} (rule: ${result.ruleName}, dry_run=true)`);
      } else {
        log("info", `MOVED ${file} -> ${dest} (rule: ${result.ruleName})`);
      }
      summary.matched++;
    } catch (e) {
      log("error", `FAILED to move ${file} -> ${result.destination}: ${e}`);
      scanStats.errors++;
    }
  }
  log(
    "info",
    `Scan summary: found=${summary.found} matched=${summary.matched} skipped=${summary.skipped} errors=${scanStats.errors}`
  );
  log("info", "Scan complete.");
  process.exit(0);
}

// Daemon mode
const retryQueue = new RetryQueue(config.safety.max_retries);
const stabilityDelay = config.safety.stability_delay_seconds * 1000;
const retryInterval = config.safety.retry_interval_seconds * 1000;

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

startWatching(watchPaths, handleEvent);

// Retry timer
setInterval(() => {
  const ready = retryQueue.drainReady();
  for (const path of ready) {
    log("info", `RETRY ${path}`);
    try {
      processFile(path);
    } catch {
      retryQueue.add(path);
    }
  }
}, retryInterval);

log("info", "FileFlow daemon running. Press Ctrl+C to stop.");

// Keep process alive
process.on("SIGINT", () => {
  log("info", "Shutting down...");
  process.exit(0);
});
