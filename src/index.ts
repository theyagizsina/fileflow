import { parseArgs } from "util";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { createInterface } from "readline";
import { spawnSync } from "child_process";
import { loadConfig, expandedWatchPaths, defaultConfigToml, resolveConfigPath } from "./config";
import { loadBlueprints } from "./blueprints";
import { runCreateFlow } from "./creator";
import type { PromptAdapter, FsAdapter, ExecAdapter } from "./creator";
import { Classifier } from "./classifier";
import { hasTempExtension, isFileAccessible, RetryQueue } from "./safety";
import { moveFile } from "./mover";
import { initLogger, log } from "./logger";
import { startWatching, scanExisting } from "./watcher";
import { createEventHandler } from "./daemon";
import { installStartupTask, uninstallStartupTask, isInstalled, createSchtasksAdapter } from "./scheduler";
import { getStatus } from "./status";
import { runValidation } from "./validate";
import { explainFile } from "./explain";
import { checkForUpdate, performUpdate, cleanupOldBinary } from "./updater";
import { startConfigReloader } from "./config-reloader";

const VERSION = "0.1.1";

// ── Real adapters for create command ─────────────────────────────

function createRealPrompt(): PromptAdapter & { close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (answer) => resolve(answer)));

  return {
    select: async (prompt, options) => {
      console.log(`\n  ${prompt}`);
      options.forEach((o, i) => console.log(`    ${i + 1}) ${o.label}`));
      const answer = await ask("  > ");
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < options.length) return options[idx]!.value;
      return options[0]!.value; // fallback to first
    },
    text: async (prompt, defaultValue) => {
      const suffix = defaultValue ? ` (${defaultValue})` : "";
      const answer = await ask(`  ${prompt}${suffix}: `);
      return answer || defaultValue || "";
    },
    confirm: async (prompt, defaultValue) => {
      const suffix = defaultValue ? " [Y/n]" : " [y/N]";
      const answer = await ask(`  ${prompt}${suffix}: `);
      if (!answer) return defaultValue ?? false;
      return answer.toLowerCase().startsWith("y");
    },
    close: () => rl.close(),
  };
}

function createRealFs(): FsAdapter {
  return {
    exists: (p) => existsSync(p),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
  };
}

function createRealExec(): ExecAdapter {
  return {
    run: async (command, args, cwd) => {
      const result = spawnSync(command, args, { cwd, encoding: "utf-8", shell: true });
      return {
        exitCode: result.status ?? 1,
        output: (result.stdout || "") + (result.stderr || ""),
      };
    },
  };
}

// Clean up leftover .old binary from a previous update
cleanupOldBinary(resolve(process.execPath));

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    config: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "scan-once": { type: "boolean", default: false },
    init: { type: "boolean", default: false },
    install: { type: "boolean", default: false },
    uninstall: { type: "boolean", default: false },
    status: { type: "boolean", default: false },
    validate: { type: "boolean", default: false },
    update: { type: "boolean", default: false },
    explain: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
    yes: { type: "boolean", short: "y", default: false },
  },
});

if (values.version) {
  console.log(`fileflow ${VERSION}`);
  process.exit(0);
}

if (values.help) {
  console.log(`fileflow ${VERSION} — automatic file organizer daemon

Usage: fileflow [options]
       fileflow create <name> [options]

Commands:
  create <name>     Create a new project under projects.root

Options:
  --config <path>   Config file path (default: %APPDATA%\\FileFlow\\fileflow.toml, then CWD)
  --scan-once       Scan existing files and exit
  --dry-run         Show what would be moved without moving
  --init            Create default config file
  --install         Register as startup task (Task Scheduler)
  --uninstall       Remove startup task
  --status          Show current configuration and status
  --validate        Validate config, paths, and permissions
  --update          Update to latest version
  --explain <file>  Show which rule matches a file and why
  --yes, -y         Auto-confirm shell actions in create
  --help, -h        Show this help message
  --version, -v     Show version number`);
  process.exit(0);
}

if (values.update) {
  const exePath = resolve(process.execPath);
  console.log(`Current version: ${VERSION}`);
  console.log("Checking for updates...");
  try {
    const result = await checkForUpdate({
      currentVersion: VERSION,
      fetchFn: fetch,
      repoOwner: "theyagizsina",
      repoName: "fileflow",
    });
    if (!result.available) {
      console.log("Already up to date.");
      process.exit(0);
    }
    console.log(`v${result.latestVersion} available`);
    console.log("Downloading fileflow.exe...");
    await performUpdate({
      exePath,
      downloadUrl: result.downloadUrl!,
      fetchFn: fetch,
    });
    console.log(`Updated to v${result.latestVersion}. Restart fileflow to use the new version.`);
  } catch (e) {
    console.error(`Update failed: ${e}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Create command ───────────────────────────────────────────────

if (positionals[0] === "create") {
  const projectName = positionals[1];
  if (!projectName) {
    console.error("Usage: fileflow create <project-name>");
    process.exit(1);
  }

  const prompt = createRealPrompt();

  // Load config — or work without one
  const createConfigPath = resolve(resolveConfigPath(values.config, existsSync));
  let createConfig: ReturnType<typeof loadConfig> | null = null;

  if (existsSync(createConfigPath)) {
    createConfig = loadConfig(createConfigPath);
  }

  let projectsRoot = createConfig?.projects?.root;
  let allowedCommands = createConfig?.projects?.allowed_commands;

  // If projects.root is missing, ask interactively
  if (!projectsRoot) {
    console.log("\n  No [projects] section found in config.\n");
    const root = await new Promise<string>((res) => {
      const rl = prompt as any;
      rl.text("Projects root directory (where projects are created)", undefined).then(res);
    });

    if (!root || root.trim() === "") {
      prompt.close();
      console.error("Projects root is required.");
      process.exit(1);
    }

    projectsRoot = resolve(root.trim());

    // Offer to save to config
    const shouldSave = await new Promise<boolean>((res) => {
      (prompt as any).confirm("Save this to config for next time?", true).then(res);
    });

    if (shouldSave) {
      const savePath = existsSync(createConfigPath) ? createConfigPath : resolve("fileflow.toml");
      try {
        let content = "";
        if (existsSync(savePath)) {
          content = readFileSync(savePath, "utf-8");
        }
        // Append [projects] section
        const section = `\n[projects]\nroot = "${projectsRoot.replace(/\\/g, "\\\\")}"\n`;
        writeFileSync(savePath, content + section);
        console.log(`  Saved to ${savePath}\n`);
      } catch (e: any) {
        console.error(`  Could not save config: ${e.message}\n`);
      }
    }
  }

  // Load blueprints (optional)
  let blueprintsConfig = undefined;
  const bpPath = createConfig?.projects?.blueprints;
  if (bpPath) {
    const resolvedBp = resolve(bpPath);
    if (existsSync(resolvedBp)) {
      const bpResult = loadBlueprints(resolvedBp);
      if (bpResult.ok) {
        blueprintsConfig = bpResult.value;
      } else {
        console.error("Blueprint config errors:");
        bpResult.errors.forEach((e) => console.error(`  - ${e}`));
        console.log("Falling back to default flow.\n");
      }
    }
  }

  console.log("\n  FileFlow Project Creator\n");

  try {
    const summary = await runCreateFlow({
      projectName,
      projectsRoot,
      blueprints: blueprintsConfig,
      yes: values.yes,
      allowedCommands,
      prompt,
      fs: createRealFs(),
      exec: createRealExec(),
    });

    prompt.close();

    console.log("");
    for (const action of summary.actions) {
      const icon = action.success ? "+" : "!";
      console.log(`  [${icon}] ${action.action}`);
    }
    console.log(`\n  Project: ${summary.projectPath}`);
    if (!summary.success) {
      console.log("\n  Some actions failed. Check the output above.");
      process.exit(1);
    }
    console.log(`\n  Next:\n    cd ${summary.projectPath}\n`);
  } catch (e: any) {
    prompt.close();
    console.error(`\nError: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

const configPath = resolve(resolveConfigPath(values.config, existsSync));
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
  const exePath = resolve(process.execPath);
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

if (values.validate) {
  const watchPaths = expandedWatchPaths(config);
  const result = runValidation({
    configPath,
    watchPaths,
    rules: config.rules,
    pathExists: existsSync,
    isWritable: (p: string) => {
      try {
        const fs = require("fs");
        fs.accessSync(p, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
  });
  console.log(result.report);
  process.exit(result.ok ? 0 : 1);
}

if (values.explain) {
  const result = explainFile({
    filePath: values.explain,
    rules: config.rules,
    ignoreExtensions: config.safety.ignore_extensions,
  });
  console.log(result.report);
  process.exit(0);
}

initLogger(config.logging);

log("info", "FileFlow starting...");
if (dryRun) log("info", "[DRY-RUN] mode enabled — no files will be moved");

let classifier = new Classifier(config.rules);
let currentIgnoreExtensions = config.safety.ignore_extensions;
const watchPaths = expandedWatchPaths(config);

function processFile(filePath: string): void {
  if (hasTempExtension(filePath, currentIgnoreExtensions)) {
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
let stabilityDelay = config.safety.stability_delay_seconds * 1000;
let retryInterval = config.safety.retry_interval_seconds * 1000;

const handleEvent = createEventHandler({
  get stabilityDelayMs() { return stabilityDelay; },
  hasTempExtensionFn: (path) => hasTempExtension(path, currentIgnoreExtensions),
  processFile: async (path) => processFile(path),
  existsFn: existsSync,
  accessibleFn: isFileAccessible,
  sleepFn: (ms) => Bun.sleep(ms),
  logFn: log,
  retryQueue,
});

const watcher = startWatching(watchPaths, handleEvent);

const stopConfigReloader = startConfigReloader({
  configPath,
  currentConfig: config,
  onReload: (newConfig, diff) => {
    // Rebuild classifier with new rules
    classifier = new Classifier(newConfig.rules);

    // Update ignore extensions list
    currentIgnoreExtensions = newConfig.safety.ignore_extensions;

    // Update stability delay — read per-event via getter, so this takes effect immediately
    stabilityDelay = newConfig.safety.stability_delay_seconds * 1000;
    // TODO: retryInterval cannot be updated by reassignment — setInterval captures the value at
    // creation time. To support live retry-interval changes, the interval would need to be
    // cleared and restarted here. Deferred for now.

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
  stopConfigReloader();
  watcher.close();
  log("info", "Shutting down...");
  process.exit(0);
});
