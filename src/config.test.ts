import { describe, test, expect } from "bun:test";
import { loadConfig, expandEnvVars } from "./config";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe("expandEnvVars", () => {
  test("expands %VAR% patterns", () => {
    process.env.FILEFLOW_TEST_USER = "testuser";
    expect(expandEnvVars("C:\\Users\\%FILEFLOW_TEST_USER%\\Downloads"))
      .toBe("C:\\Users\\testuser\\Downloads");
    delete process.env.FILEFLOW_TEST_USER;
  });

  test("leaves string unchanged when no vars", () => {
    expect(expandEnvVars("C:\\Users\\sina\\Downloads"))
      .toBe("C:\\Users\\sina\\Downloads");
  });

  test("replaces missing vars with empty string", () => {
    expect(expandEnvVars("C:\\Users\\%NONEXISTENT_XYZ%\\Downloads"))
      .toBe("C:\\Users\\\\Downloads");
  });
});

describe("loadConfig", () => {
  const tmpDir = join(process.env.TEMP || "/tmp", "fileflow_test_config");

  test("parses minimal config", () => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, "test.toml");
    writeFileSync(configPath, `
[watch]
paths = ["C:\\\\Users\\\\test\\\\Downloads"]

[safety]
ignore_extensions = [".tmp", ".crdownload"]

[logging]
path = "fileflow.log"
`);
    const config = loadConfig(configPath);
    expect(config.watch.paths).toHaveLength(1);
    expect(config.safety.ignore_extensions).toHaveLength(2);
    expect(config.safety.stability_delay_seconds).toBe(3);
    expect(config.safety.max_retries).toBe(30);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("parses config with rules", () => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, "rules.toml");
    writeFileSync(configPath, `
[watch]
paths = ["C:\\\\Downloads"]

[safety]
ignore_extensions = [".tmp"]

[logging]
path = "fileflow.log"

[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*", "Screen Shot*"]
destination = "W:\\\\Media\\\\Screenshots"

[[rules]]
name = "Videos"
type = "extension"
match = [".mp4", ".mkv"]
destination = "W:\\\\Media\\\\Videos"
`);
    const config = loadConfig(configPath);
    expect(config.rules).toHaveLength(2);
    expect(config.rules[0].type).toBe("pattern");
    expect(config.rules[1].type).toBe("extension");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
