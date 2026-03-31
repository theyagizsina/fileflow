import { describe, test, expect, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startWatching } from "./watcher";

describe("startWatching", () => {
  let tempDir: string;

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("detects files created in subdirectories (recursive watching)", async () => {
    // Setup: create a temp dir with a subdirectory
    tempDir = join(tmpdir(), `fileflow-watcher-test-${Date.now()}`);
    const subDir = join(tempDir, "subfolder");
    mkdirSync(subDir, { recursive: true });

    // Track events received by the callback
    const events: { type: string; path: string }[] = [];
    const gotEvent = new Promise<void>((resolve) => {
      startWatching([tempDir], (event) => {
        events.push(event);
        resolve();
      });
    });

    // Give the watcher a moment to initialize
    await new Promise((r) => setTimeout(r, 100));

    // Create a file in the subdirectory — should trigger the callback
    const testFile = join(subDir, "test-file.txt");
    writeFileSync(testFile, "hello");

    // Wait for the event with a timeout
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for watcher event")), 2000)
    );

    await Promise.race([gotEvent, timeout]);

    // Verify the callback was invoked with the correct full path
    expect(events.length).toBeGreaterThanOrEqual(1);
    const matchingEvent = events.find((e) => e.path === testFile);
    expect(matchingEvent).toBeDefined();
  });

  test("returns a watcher handle with a close method", () => {
    const tmpDir2 = join(tmpdir(), `fileflow-watcher-handle-test-${Date.now()}`);
    mkdirSync(tmpDir2, { recursive: true });
    const handle = startWatching([tmpDir2], () => {});
    expect(typeof handle.close).toBe("function");
    handle.close();
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  test("handle.add() watches a newly added directory", async () => {
    const baseDir = join(tmpdir(), `fileflow-watcher-add-test-${Date.now()}`);
    const newDir = join(baseDir, "newdir");
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });

    const events: string[] = [];
    const handle = startWatching([baseDir], (event) => {
      events.push(event.path);
    });

    // Add a new directory to watch
    handle.add(newDir);

    // Give watcher time to initialise
    await new Promise((r) => setTimeout(r, 100));

    const testFile = join(newDir, "added-file.txt");
    writeFileSync(testFile, "hello");

    await new Promise((r) => setTimeout(r, 500));

    handle.close();
    rmSync(baseDir, { recursive: true, force: true });

    // The file created in newDir should have been seen
    expect(events.some((p) => p === testFile)).toBe(true);
  });

  test("handle.unwatch() stops watching a directory", async () => {
    const dir = join(tmpdir(), `fileflow-watcher-unwatch-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const events: string[] = [];
    const handle = startWatching([dir], (event) => {
      events.push(event.path);
    });

    await new Promise((r) => setTimeout(r, 100));

    // Unwatch the directory
    handle.unwatch(dir);

    await new Promise((r) => setTimeout(r, 100));

    // Create a file — should NOT trigger the callback
    const testFile = join(dir, "unwatched-file.txt");
    writeFileSync(testFile, "should not trigger");

    await new Promise((r) => setTimeout(r, 500));

    handle.close();
    rmSync(dir, { recursive: true, force: true });

    expect(events.some((p) => p === testFile)).toBe(false);
  });

  test("handle.add() is idempotent — calling twice does not double-register", async () => {
    const dir = join(tmpdir(), `fileflow-watcher-idempotent-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const events: string[] = [];
    const handle = startWatching([dir], (event) => {
      events.push(event.path);
    });

    // Call add() again for the same dir — should not throw or double up
    expect(() => handle.add(dir)).not.toThrow();

    await new Promise((r) => setTimeout(r, 100));

    const testFile = join(dir, "idempotent-file.txt");
    writeFileSync(testFile, "once");

    await new Promise((r) => setTimeout(r, 500));

    handle.close();
    rmSync(dir, { recursive: true, force: true });

    // File should appear at most twice in events — fs.watch on some platforms
    // (e.g. Windows) naturally fires up to two raw events per write even with
    // a single watcher; what we're verifying is that the second add() call did
    // NOT register a duplicate watcher (which would produce 3–4 events).
    const matches = events.filter((p) => p === testFile);
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});
