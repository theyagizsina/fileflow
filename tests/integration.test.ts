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
    expect(output).toContain("--validate");
    expect(output).toContain("--explain <file>");
  });

  test("--status shows config and watch paths", async () => {
    const dir = setup("status");
    const watchDir = join(dir, "watch");
    mkdirSync(watchDir, { recursive: true });
    const configPath = writeConfig(dir, [watchDir], dir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${dir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --status --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("FileFlow Status");
    expect(output).toContain(configPath);
    expect(output).toContain("Rules:");
  });

  test("--validate passes with valid config", async () => {
    const dir = setup("validate_pass");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --validate --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("PASS");
  });

  test("--validate fails with missing destination", async () => {
    const dir = setup("validate_fail");
    const watchDir = join(dir, "watch");
    mkdirSync(watchDir, { recursive: true });
    const configPath = writeConfig(dir, [watchDir], dir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${join(dir, "nonexistent").replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --validate --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("FAIL");
  });

  test("--explain shows matching rule", async () => {
    const dir = setup("explain_match");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --explain report.pdf --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("Docs");
    expect(output).toContain("MATCH");
  });

  test("--explain shows no match for unknown extension", async () => {
    const dir = setup("explain_nomatch");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts --explain random.xyz --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("No rule matched");
  });

  test("create command fails without project name", async () => {
    const dir = setup("create_no_name");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });
    const projectsRoot = join(dir, "projects");
    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"

[projects]
root = "${projectsRoot.replace(/\\/g, "\\\\")}"
`);

    const result = await $`bun run src/index.ts create --config ${configPath}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    const stderr = Buffer.from(result.stderr).toString("utf-8");
    expect(stderr).toContain("Usage: fileflow create");
  });

  test("create command prompts for projects.root when config has no [projects] section", async () => {
    const dir = setup("create_no_projects");
    const watchDir = join(dir, "watch");
    const destDir = join(dir, "dest");
    mkdirSync(watchDir, { recursive: true });
    const configPath = writeConfig(dir, [watchDir], destDir, `
[[rules]]
name = "Docs"
type = "extension"
match = [".pdf"]
destination = "${destDir.replace(/\\/g, "\\\\")}"
`);

    // Send empty input to the prompt so it fails with "required"
    const proc = Bun.spawn(["bun", "run", "src/index.ts", "create", "my-app", "--config", configPath], {
      stdin: new Blob(["\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Projects root is required");
  });

  test("--help includes create command and --yes option", async () => {
    const result = await $`bun run src/index.ts --help`.quiet().nothrow();
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(result.stdout).toString("utf-8");
    expect(output).toContain("create <name>");
    expect(output).toContain("--yes");
  });
});
