import { describe, test, expect } from "bun:test";
import { hasTempExtension, isFileAccessible, RetryQueue } from "./safety";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const ignoreExts = [".tmp", ".crdownload", ".part", ".partial", ".download", ".opdownload"];

describe("hasTempExtension", () => {
  test("detects temp extensions", () => {
    expect(hasTempExtension("file.crdownload", ignoreExts)).toBe(true);
    expect(hasTempExtension("file.TMP", ignoreExts)).toBe(true);
    expect(hasTempExtension("download.part", ignoreExts)).toBe(true);
  });

  test("allows normal extensions", () => {
    expect(hasTempExtension("report.pdf", ignoreExts)).toBe(false);
    expect(hasTempExtension("photo.jpg", ignoreExts)).toBe(false);
  });

  test("handles no extension", () => {
    expect(hasTempExtension("noext", ignoreExts)).toBe(false);
  });
});

describe("isFileAccessible", () => {
  test("returns true for normal file", () => {
    const dir = join(process.env.TEMP || "/tmp", "fileflow_test_access");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "normal.txt");
    writeFileSync(file, "data");
    expect(isFileAccessible(file)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("RetryQueue", () => {
  test("no duplicates", () => {
    const queue = new RetryQueue(3);
    queue.add("test.txt");
    queue.add("test.txt");
    expect(queue.size).toBe(1);
  });

  test("drains ready files", () => {
    const dir = join(process.env.TEMP || "/tmp", "fileflow_test_retry");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "ready.txt");
    writeFileSync(file, "content");

    const queue = new RetryQueue(30);
    queue.add(file);
    const ready = queue.drainReady();
    expect(ready).toHaveLength(1);
    expect(ready[0]).toBe(file);
    expect(queue.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  test("removes entries exceeding max retries", () => {
    const dir = join(process.env.TEMP || "/tmp", "fileflow_test_retry_max");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "stuck.txt");
    writeFileSync(file, "content");

    const queue = new RetryQueue(0);
    queue.add(file);
    const ready = queue.drainReady();
    // maxRetries=0, retryCount becomes 1 > 0, so should be removed
    expect(queue.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
