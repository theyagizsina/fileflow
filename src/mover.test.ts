import { describe, test, expect, mock, spyOn } from "bun:test";
import { uniqueDestination, moveFile, crossDriveMove } from "./mover";
import * as logger from "./logger";
import * as fs from "fs";
import { join } from "path";

const { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } = fs;

const tmpBase = join(process.env.TEMP || "/tmp", "fileflow_test_mover");

function setup(subdir: string) {
  const dir = join(tmpBase, subdir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("uniqueDestination", () => {
  test("returns original path when no conflict", () => {
    const dir = setup("unique_no_conflict");
    expect(uniqueDestination(dir, "test.txt")).toBe(join(dir, "test.txt"));
  });

  test("appends _1 when file exists", () => {
    const dir = setup("unique_conflict");
    writeFileSync(join(dir, "test.txt"), "existing");
    expect(uniqueDestination(dir, "test.txt")).toBe(join(dir, "test_1.txt"));
  });

  test("appends _2 when _1 also exists", () => {
    const dir = setup("unique_conflict2");
    writeFileSync(join(dir, "test.txt"), "existing");
    writeFileSync(join(dir, "test_1.txt"), "existing");
    expect(uniqueDestination(dir, "test.txt")).toBe(join(dir, "test_2.txt"));
  });

  test("handles files without extension", () => {
    const dir = setup("unique_noext");
    writeFileSync(join(dir, "Makefile"), "existing");
    expect(uniqueDestination(dir, "Makefile")).toBe(join(dir, "Makefile_1"));
  });
});

describe("moveFile", () => {
  test("moves file to destination", () => {
    const dir = setup("move_basic");
    const srcDir = join(dir, "src");
    const dstDir = join(dir, "dst");
    mkdirSync(srcDir, { recursive: true });

    const source = join(srcDir, "hello.txt");
    writeFileSync(source, "hello world");

    const result = moveFile(source, dstDir, false);
    expect(result).toBe(join(dstDir, "hello.txt"));
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(result, "utf-8")).toBe("hello world");
  });

  test("dry run does not move file", () => {
    const dir = setup("move_dryrun");
    const srcDir = join(dir, "src");
    const dstDir = join(dir, "dst");
    mkdirSync(srcDir, { recursive: true });

    const source = join(srcDir, "keep.txt");
    writeFileSync(source, "data");

    const result = moveFile(source, dstDir, true);
    expect(result).toBe(join(dstDir, "keep.txt"));
    expect(existsSync(source)).toBe(true);
  });

  test("creates destination directory", () => {
    const dir = setup("move_mkdir");
    const srcDir = join(dir, "src");
    const dstDir = join(dir, "deep", "nested", "dst");
    mkdirSync(srcDir, { recursive: true });

    const source = join(srcDir, "file.txt");
    writeFileSync(source, "content");

    moveFile(source, dstDir, false);
    expect(existsSync(join(dstDir, "file.txt"))).toBe(true);
  });
});

describe("crossDriveMove", () => {
  test("successfully copies and deletes source", () => {
    const dir = setup("cross_basic");
    const source = join(dir, "source.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(source, "cross drive content");

    crossDriveMove(source, dest);

    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf-8")).toBe("cross drive content");
    expect(existsSync(source)).toBe(false);
  });

  test("verifies copy size matches source size", () => {
    const dir = setup("cross_size_verify");
    const source = join(dir, "source.txt");
    const dest = join(dir, "dest.txt");
    const content = "A".repeat(1024);
    writeFileSync(source, content);

    crossDriveMove(source, dest);

    const srcSizeBefore = 1024; // we know the content length
    const destSize = statSync(dest).size;
    expect(destSize).toBe(srcSizeBefore);
  });

  test("cleans up partial destination file when copyFileSync fails", () => {
    const dir = setup("cross_copy_fail");
    const source = join(dir, "source.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(source, "original data");
    // Pre-create a partial file at dest to simulate a partial copy left behind
    writeFileSync(dest, "partial");

    // Mock copyFileSync to throw (simulating disk full).
    // The function should clean up dest before re-throwing.
    const copySpy = spyOn(fs, "copyFileSync").mockImplementation(() => {
      // Simulate: partial file already written at dest, then error
      writeFileSync(dest, "partial garbage");
      throw new Error("ENOSPC: no space left on device");
    });

    try {
      expect(() => crossDriveMove(source, dest)).toThrow("ENOSPC");
      // The partial destination file should have been cleaned up
      expect(existsSync(dest)).toBe(false);
      // Source should still exist (copy failed, nothing was deleted)
      expect(existsSync(source)).toBe(true);
    } finally {
      copySpy.mockRestore();
    }
  });

  test("throws error with both paths when unlinkSync fails after successful copy", () => {
    const dir = setup("cross_unlink_fail");
    const source = join(dir, "source.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(source, "important data");

    const unlinkSpy = spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("EBUSY: resource busy or locked");
    });
    const logSpy = spyOn(logger, "log");

    try {
      expect(() => crossDriveMove(source, dest)).toThrow(/EBUSY|resource busy/i);

      // Destination should still exist (copy succeeded)
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, "utf-8")).toBe("important data");

      // Source also still exists (unlink failed)
      expect(existsSync(source)).toBe(true);

      // A warning should have been logged about duplication
      const warnCalls = logSpy.mock.calls.filter(
        (call: any[]) => call[0] === "warn"
      );
      expect(warnCalls.length).toBeGreaterThan(0);
      // Warning message should contain both paths
      const warnMessage = warnCalls[0]![1] as string;
      expect(warnMessage).toContain(source);
      expect(warnMessage).toContain(dest);
    } finally {
      unlinkSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  test("throws error with size mismatch if copy produces wrong size", () => {
    const dir = setup("cross_size_mismatch");
    const source = join(dir, "source.txt");
    const dest = join(dir, "dest.txt");
    writeFileSync(source, "full content here");

    const copySpy = spyOn(fs, "copyFileSync").mockImplementation((_src: any, dst: any) => {
      // Write truncated content to simulate a bad copy
      writeFileSync(dst as string, "short");
    });

    try {
      expect(() => crossDriveMove(source, dest)).toThrow(/size mismatch/i);
      // Partial/wrong dest should be cleaned up
      expect(existsSync(dest)).toBe(false);
      // Source should still exist
      expect(existsSync(source)).toBe(true);
    } finally {
      copySpy.mockRestore();
    }
  });
});
