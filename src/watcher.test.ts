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
});
