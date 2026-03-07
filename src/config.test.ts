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

  test("expands env vars in rule destinations", () => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });

    process.env.FILEFLOW_TEST_DEST = "C:\\Users\\testuser";
    const configPath = join(tmpDir, "envdest.toml");
    writeFileSync(configPath, `
[watch]
paths = ["C:\\\\Downloads"]

[safety]
ignore_extensions = [".tmp"]

[logging]
path = "fileflow.log"

[[rules]]
name = "Archives"
type = "extension"
match = [".zip", ".rar"]
destination = "%FILEFLOW_TEST_DEST%\\\\Documents\\\\Archives"
`);
    const config = loadConfig(configPath);
    expect(config.rules[0].destination).toBe("C:\\Users\\testuser\\Documents\\Archives");

    delete process.env.FILEFLOW_TEST_DEST;
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("config validation", () => {
  const tmpDir = join(process.env.TEMP || "/tmp", "fileflow_test_validation");

  function loadToml(toml: string) {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const configPath = join(tmpDir, "val.toml");
    writeFileSync(configPath, toml);
    return () => loadConfig(configPath);
  }

  const validBase = `
[watch]
paths = ["C:\\\\Downloads"]

[safety]
ignore_extensions = [".tmp"]
stability_delay_seconds = 3
retry_interval_seconds = 10
max_retries = 30

[logging]
path = "fileflow.log"
`;

  test("valid config with rules loads without errors", () => {
    const load = loadToml(validBase + `
[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*"]
destination = "W:\\\\Media\\\\Screenshots"
`);
    expect(load).not.toThrow();
  });

  test("throws when rule has invalid type", () => {
    const load = loadToml(validBase + `
[[rules]]
name = "Screenshots"
type = "foo"
match = ["Screenshot*"]
destination = "W:\\\\Media\\\\Screenshots"
`);
    expect(load).toThrow(/Rule 'Screenshots' has invalid type 'foo'/);
  });

  test("throws when rule is missing name", () => {
    const load = loadToml(validBase + `
[[rules]]
type = "pattern"
match = ["Screenshot*"]
destination = "W:\\\\Media\\\\Screenshots"
`);
    expect(load).toThrow(/Rule at index 0 is missing required field 'name'/);
  });

  test("throws when rule has empty match array", () => {
    const load = loadToml(validBase + `
[[rules]]
name = "Screenshots"
type = "pattern"
match = []
destination = "W:\\\\Media\\\\Screenshots"
`);
    expect(load).toThrow(/Rule 'Screenshots' has empty 'match' array/);
  });

  test("throws when rule is missing destination", () => {
    const load = loadToml(validBase + `
[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*"]
`);
    expect(load).toThrow(/Rule 'Screenshots' is missing required field 'destination'/);
  });

  test("throws when rule has empty destination", () => {
    const load = loadToml(validBase + `
[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*"]
destination = ""
`);
    expect(load).toThrow(/Rule 'Screenshots' has empty 'destination'/);
  });

  test("throws when stability_delay_seconds is negative", () => {
    const load = loadToml(`
[watch]
paths = ["C:\\\\Downloads"]

[safety]
stability_delay_seconds = -1

[logging]
path = "fileflow.log"
`);
    expect(load).toThrow(/stability_delay_seconds must be a non-negative number, got -1/);
  });

  test("throws when retry_interval_seconds is negative", () => {
    const load = loadToml(`
[watch]
paths = ["C:\\\\Downloads"]

[safety]
retry_interval_seconds = -2

[logging]
path = "fileflow.log"
`);
    expect(load).toThrow(/retry_interval_seconds must be a non-negative number, got -2/);
  });

  test("throws when max_retries is negative", () => {
    const load = loadToml(`
[watch]
paths = ["C:\\\\Downloads"]

[safety]
max_retries = -5

[logging]
path = "fileflow.log"
`);
    expect(load).toThrow(/max_retries must be a non-negative integer, got -5/);
  });

  test("throws when watch.paths is empty", () => {
    const load = loadToml(`
[watch]
paths = []

[logging]
path = "fileflow.log"
`);
    expect(load).toThrow(/watch\.paths must be a non-empty array/);
  });

  test("throws when watch.paths is missing", () => {
    const load = loadToml(`
[logging]
path = "fileflow.log"
`);
    expect(load).toThrow(/watch\.paths must be a non-empty array/);
  });
});
