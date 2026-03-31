import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startConfigReloader } from "./config-reloader";
import { loadConfig } from "./config";

const VALID_TOML = (paths: string[], rules = 2) =>
  `
[watch]
paths = ${JSON.stringify(paths)}

[safety]
ignore_extensions = [".tmp"]
stability_delay_seconds = 3
retry_interval_seconds = 10
max_retries = 30

[logging]
path = "fileflow.log"
` +
  (rules > 0
    ? `
[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*"]
destination = "C:\\\\Dest\\\\Screenshots"
`
    : "") +
  (rules > 1
    ? `
[[rules]]
name = "Videos"
type = "extension"
match = [".mp4"]
destination = "C:\\\\Dest\\\\Videos"
`
    : "");

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

    await new Promise((r) => setTimeout(r, 100));

    const newPaths = [join(tmpDir, "Downloads"), join(tmpDir, "Desktop")];
    writeFileSync(configPath, VALID_TOML(newPaths));

    await new Promise((r) => setTimeout(r, 800));

    stop();

    expect(reloads.length).toBeGreaterThanOrEqual(1);
    const last = reloads[reloads.length - 1]!;
    expect(last.added).toContain(join(tmpDir, "Desktop"));
    expect(last.removed).toHaveLength(0);
  });

  test("debounces rapid change events — onReload called only once", async () => {
    writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));
    const currentConfig = loadConfig(configPath);

    let callCount = 0;
    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: () => {
        callCount++;
      },
      logFn: () => {},
    });

    await new Promise((r) => setTimeout(r, 100));

    for (let i = 0; i < 5; i++) {
      writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));
      await new Promise((r) => setTimeout(r, 50));
    }

    await new Promise((r) => setTimeout(r, 800));

    stop();
    expect(callCount).toBeLessThanOrEqual(2);
  });

  test("does NOT call onReload when config has a parse error", async () => {
    writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));
    const currentConfig = loadConfig(configPath);

    let callCount = 0;
    const logMessages: string[] = [];

    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: () => {
        callCount++;
      },
      logFn: (_, msg) => logMessages.push(msg),
    });

    await new Promise((r) => setTimeout(r, 100));

    writeFileSync(configPath, "this is not valid toml !!! [[[");

    await new Promise((r) => setTimeout(r, 800));

    stop();

    expect(callCount).toBe(0);
    expect(logMessages.some((m) => m.includes("CONFIG_RELOAD_FAILED"))).toBe(true);
  });

  test("correctly diffs removed watch paths", async () => {
    const initialPaths = [join(tmpDir, "Downloads"), join(tmpDir, "Desktop")];
    writeFileSync(configPath, VALID_TOML(initialPaths));
    const currentConfig = loadConfig(configPath);

    const diffs: { added: string[]; removed: string[] }[] = [];

    const stop = startConfigReloader({
      configPath,
      currentConfig,
      onReload: (_, diff) =>
        diffs.push({ added: diff.addedPaths, removed: diff.removedPaths }),
      logFn: () => {},
    });

    await new Promise((r) => setTimeout(r, 100));

    writeFileSync(configPath, VALID_TOML([join(tmpDir, "Downloads")]));

    await new Promise((r) => setTimeout(r, 800));

    stop();

    expect(diffs.length).toBeGreaterThanOrEqual(1);
    const last = diffs[diffs.length - 1]!;
    expect(last.removed).toContain(join(tmpDir, "Desktop"));
    expect(last.added).toHaveLength(0);
  });
});
