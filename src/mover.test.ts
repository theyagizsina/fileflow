import { describe, test, expect } from "bun:test";
import { uniqueDestination, moveFile } from "./mover";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";

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
