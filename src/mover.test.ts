import { describe, test, expect, mock, spyOn, beforeEach } from "bun:test";
import { uniqueDestination, moveFile, crossDriveMove, activeMoves } from "./mover";
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
      let thrownError: Error | undefined;
      try {
        crossDriveMove(source, dest);
      } catch (e) {
        thrownError = e as Error;
      }

      // Error must have been thrown
      expect(thrownError).toBeDefined();
      // Error message must contain both paths
      expect(thrownError!.message).toContain(source);
      expect(thrownError!.message).toContain(dest);
      // Original error preserved as cause
      expect(thrownError!.cause).toBeInstanceOf(Error);
      expect((thrownError!.cause as Error).message).toContain("EBUSY");

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

describe("activeMoves lock set — race condition prevention", () => {
  beforeEach(() => {
    activeMoves.clear();
  });

  test("two concurrent moves for same-named file get different destinations", () => {
    const dir = setup("race_concurrent");
    const srcDir = join(dir, "src");
    const dstDir = join(dir, "dst");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(dstDir, { recursive: true });

    // Create two source files with the same name in different subdirs
    const srcDirA = join(srcDir, "a");
    const srcDirB = join(srcDir, "b");
    mkdirSync(srcDirA, { recursive: true });
    mkdirSync(srcDirB, { recursive: true });
    const sourceA = join(srcDirA, "report.txt");
    const sourceB = join(srcDirB, "report.txt");
    writeFileSync(sourceA, "content from A");
    writeFileSync(sourceB, "content from B");

    // Mock renameSync to be slow — simulate the race window where both calls
    // compute uniqueDestination before either has actually moved the file.
    // We use a spy that captures the rename calls to observe both destinations.
    const renameCalls: Array<[string, string]> = [];
    const origRename = fs.renameSync;
    const renameSpy = spyOn(fs, "renameSync").mockImplementation((src: any, dst: any) => {
      renameCalls.push([src as string, dst as string]);
      origRename(src, dst);
    });

    try {
      const resultA = moveFile(sourceA, dstDir, false);
      const resultB = moveFile(sourceB, dstDir, false);

      // The two results must be DIFFERENT paths — no silent overwrite
      expect(resultA).not.toBe(resultB);

      // Both destination files must exist
      expect(existsSync(resultA)).toBe(true);
      expect(existsSync(resultB)).toBe(true);

      // Content must be preserved — no data loss
      const contents = new Set([
        readFileSync(resultA, "utf-8"),
        readFileSync(resultB, "utf-8"),
      ]);
      expect(contents.has("content from A")).toBe(true);
      expect(contents.has("content from B")).toBe(true);
    } finally {
      renameSpy.mockRestore();
    }
  });

  test("activeMoves set is exported and accessible", () => {
    expect(activeMoves).toBeInstanceOf(Set);
  });

  test("activeMoves is empty after moveFile completes", () => {
    const dir = setup("race_cleanup");
    const srcDir = join(dir, "src");
    const dstDir = join(dir, "dst");
    mkdirSync(srcDir, { recursive: true });

    const source = join(srcDir, "file.txt");
    writeFileSync(source, "data");

    moveFile(source, dstDir, false);

    // After move completes, the lock must be released
    expect(activeMoves.size).toBe(0);
  });

  test("activeMoves is cleaned up even when moveFile throws", () => {
    const dir = setup("race_cleanup_error");
    const srcDir = join(dir, "src");
    const dstDir = join(dir, "dst");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(dstDir, { recursive: true });

    const source = join(srcDir, "fail.txt");
    writeFileSync(source, "data");

    const renameSpy = spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    });

    try {
      expect(() => moveFile(source, dstDir, false)).toThrow("EACCES");
      // Lock must still be released despite the error
      expect(activeMoves.size).toBe(0);
    } finally {
      renameSpy.mockRestore();
    }
  });

  test("lock prevents same destination when first move is in-flight", () => {
    const dir = setup("race_inflight");
    const srcDir = join(dir, "src");
    const dstDir = join(dir, "dst");
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(dstDir, { recursive: true });

    const srcDirA = join(srcDir, "a");
    const srcDirB = join(srcDir, "b");
    mkdirSync(srcDirA, { recursive: true });
    mkdirSync(srcDirB, { recursive: true });
    const sourceA = join(srcDirA, "doc.pdf");
    const sourceB = join(srcDirB, "doc.pdf");
    writeFileSync(sourceA, "pdf-A");
    writeFileSync(sourceB, "pdf-B");

    // Simulate race: first move "holds" the lock while second computes destination
    // We intercept renameSync on the first call to do the second move mid-flight
    let secondResult: string | undefined;
    const origRename = fs.renameSync;
    let callCount = 0;
    const renameSpy = spyOn(fs, "renameSync").mockImplementation((src: any, dst: any) => {
      callCount++;
      if (callCount === 1) {
        // While first rename is "in progress", trigger second moveFile
        secondResult = moveFile(sourceB, dstDir, false);
      }
      origRename(src, dst);
    });

    try {
      const firstResult = moveFile(sourceA, dstDir, false);

      expect(firstResult).not.toBe(secondResult);
      expect(existsSync(firstResult)).toBe(true);
      expect(existsSync(secondResult!)).toBe(true);
      expect(readFileSync(firstResult, "utf-8")).toBe("pdf-A");
      expect(readFileSync(secondResult!, "utf-8")).toBe("pdf-B");
    } finally {
      renameSpy.mockRestore();
    }
  });
});
