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

function writeConfig(dir: string, watchDir: string, destDir: string, rules: string): string {
  const configPath = join(dir, "test_config.toml");
  const logPath = join(dir, "test.log").replace(/\\/g, "\\\\");
  const config = `
[watch]
paths = ["${watchDir.replace(/\\/g, "\\\\")}"]

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

    const configPath = writeConfig(dir, watchDir, destDir, `
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

    const configPath = writeConfig(dir, watchDir, destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --scan-once --dry-run --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(watchDir, "doc.pdf"))).toBe(true);
  });

  test("skips temp extensions", async () => {
    const dir = setup("temp_ext");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });

    writeFileSync(join(watchDir, "download.crdownload"), "in progress");

    const configPath = writeConfig(dir, watchDir, destDir, `
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
});
