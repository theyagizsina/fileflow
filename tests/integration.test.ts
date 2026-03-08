import { describe, test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

const tmpBase = join(process.env.TEMP || "/tmp", "fileflow_integration");

function setup(name: string) {
  const dir = join(tmpBase, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeConfig(dir: string, watchDirs: string[], destDir: string, rules: string): string {
  const configPath = join(dir, "test_config.toml");
  const logPath = join(dir, "test.log").replace(/\\/g, "\\\\");
  const pathsToml = watchDirs
    .map((p) => `"${p.replace(/\\/g, "\\\\")}"`)
    .join(", ");
  const config = `
[watch]
paths = [${pathsToml}]

[safety]
ignore_extensions = [".tmp", ".crdownload"]
stability_delay_seconds = 0
retry_interval_seconds = 1
max_retries = 3

[logging]
path = "${logPath}"

${rules}
`;
  writeFileSync(configPath, config);
  return configPath;
}

describe("Integration", () => {
  test("--init creates config file", async () => {
    const dir = setup("init");
    const configPath = join(dir, "fileflow.toml");
    const result = await $`bun run src/index.ts --init --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("[watch]");
    expect(content).toContain("[[rules]]");
  });

  test("--scan-once moves files", async () => {
    const dir = setup("scan");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });

    writeFileSync(join(watchDir, "test_video.mp4"), "fake video");

    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Videos"
type = "extension"
match = [".mp4"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --scan-once --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(destDir, "test_video.mp4"))).toBe(true);
    expect(existsSync(join(watchDir, "test_video.mp4"))).toBe(false);
  });

  test("--dry-run does not move files", async () => {
    const dir = setup("dryrun");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });

    writeFileSync(join(watchDir, "doc.pdf"), "fake pdf");

    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --scan-once --dry-run --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(watchDir, "doc.pdf"))).toBe(true);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).not.toContain("MOVED ");
  });

  test("skips temp extensions", async () => {
    const dir = setup("temp_ext");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });

    writeFileSync(join(watchDir, "download.crdownload"), "in progress");

    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "All"
type = "extension"
match = [".crdownload"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --scan-once --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(watchDir, "download.crdownload"))).toBe(true);
  });

  test("--scan-once reports summary counts", async () => {
    const dir = setup("scan_summary");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });

    writeFileSync(join(watchDir, "doc.pdf"), "fake pdf");
    writeFileSync(join(watchDir, "download.crdownload"), "in progress");
    writeFileSync(join(watchDir, "random.bin"), "unknown");

    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --scan-once --dry-run --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("Scan summary: found=3 matched=1 skipped=2 errors=0");
  });

  test("--scan-once logs unreadable watch paths", async () => {
    const dir = setup("scan_missing_path");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });

    const missingDir = join(dir, "does_not_exist");

    const configPath = writeConfig(dir, [missingDir, watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --scan-once --dry-run --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("Watch path not readable during scan, skipping:");
    expect(output).toContain("Scan summary: found=0 matched=0 skipped=0 errors=1");
  });

  test("--scan-once scans nested directories recursively", async () => {
    const dir = setup("scan_recursive");
    const watchDir = join(dir, "watch");
    const nestedDir = join(watchDir, "nested", "deep");
    const destDir = join(dir, "dest");
    mkdirSync(nestedDir, { recursive: true });

    writeFileSync(join(nestedDir, "nested_doc.pdf"), "fake pdf");

    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --scan-once --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(destDir, "nested_doc.pdf"))).toBe(true);
    expect(existsSync(join(nestedDir, "nested_doc.pdf"))).toBe(false);
  });

  test("--help includes install and uninstall options", async () => {
    const result = await $`bun run src/index.ts --help`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("--install");
    expect(output).toContain("--uninstall");
  });
});
