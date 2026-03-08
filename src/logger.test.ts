import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { formatLogLine, rotateLog } from "./logger";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("formatLogLine", () => {
  test("formats log line with timestamp", () => {
    const line = formatLogLine("info", "MOVED file.txt -> W:\\Media");
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] INFO MOVED file\.txt -> W:\\Media$/);
  });

  test("formats warn level", () => {
    const line = formatLogLine("warn", "SKIPPED file.tmp");
    expect(line).toContain("WARN");
  });
});

describe("rotateLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fileflow_test_rotate_"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("renames log to {base}.1.{ext} on first rotation", () => {
    const logPath = join(tmpDir, "fileflow.log");
    writeFileSync(logPath, "A".repeat(100));

    rotateLog(logPath, 50); // 100 bytes > 50 byte limit

    expect(existsSync(logPath)).toBe(false);
    expect(existsSync(join(tmpDir, "fileflow.1.log"))).toBe(true);
    expect(readFileSync(join(tmpDir, "fileflow.1.log"), "utf-8")).toBe("A".repeat(100));
  });

  test("cascades existing rotated files", () => {
    const logPath = join(tmpDir, "fileflow.log");
    writeFileSync(logPath, "CURRENT");
    writeFileSync(join(tmpDir, "fileflow.1.log"), "FIRST");
    writeFileSync(join(tmpDir, "fileflow.2.log"), "SECOND");

    rotateLog(logPath, 0); // any size triggers rotation (limit=0)

    expect(existsSync(logPath)).toBe(false);
    expect(readFileSync(join(tmpDir, "fileflow.1.log"), "utf-8")).toBe("CURRENT");
    expect(readFileSync(join(tmpDir, "fileflow.2.log"), "utf-8")).toBe("FIRST");
    expect(readFileSync(join(tmpDir, "fileflow.3.log"), "utf-8")).toBe("SECOND");
  });

  test("deletes oldest file when max rotations exceeded", () => {
    const logPath = join(tmpDir, "fileflow.log");
    writeFileSync(logPath, "CURRENT");
    writeFileSync(join(tmpDir, "fileflow.1.log"), "FIRST");
    writeFileSync(join(tmpDir, "fileflow.2.log"), "SECOND");
    writeFileSync(join(tmpDir, "fileflow.3.log"), "THIRD");

    rotateLog(logPath, 0);

    expect(existsSync(logPath)).toBe(false);
    expect(readFileSync(join(tmpDir, "fileflow.1.log"), "utf-8")).toBe("CURRENT");
    expect(readFileSync(join(tmpDir, "fileflow.2.log"), "utf-8")).toBe("FIRST");
    expect(readFileSync(join(tmpDir, "fileflow.3.log"), "utf-8")).toBe("SECOND");
    // fileflow.3.log should be "SECOND" (was .2), "THIRD" is gone
  });

  test("does nothing if file is under size limit", () => {
    const logPath = join(tmpDir, "fileflow.log");
    writeFileSync(logPath, "small");

    rotateLog(logPath, 1024); // 5 bytes < 1024 limit

    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(join(tmpDir, "fileflow.1.log"))).toBe(false);
  });

  test("does nothing if log file does not exist", () => {
    const logPath = join(tmpDir, "nonexistent.log");

    // Should not throw
    rotateLog(logPath, 0);

    expect(existsSync(logPath)).toBe(false);
  });

  test("handles extensionless log paths", () => {
    const logPath = join(tmpDir, "fileflow");
    writeFileSync(logPath, "DATA");
    writeFileSync(join(tmpDir, "fileflow.1"), "OLD1");

    rotateLog(logPath, 0);

    expect(existsSync(logPath)).toBe(false);
    expect(readFileSync(join(tmpDir, "fileflow.1"), "utf-8")).toBe("DATA");
    expect(readFileSync(join(tmpDir, "fileflow.2"), "utf-8")).toBe("OLD1");
  });
});
