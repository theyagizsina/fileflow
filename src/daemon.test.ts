import { describe, test, expect, beforeEach } from "bun:test";
import { createEventHandler } from "./daemon";
import type { FileEvent } from "./watcher";

/**
 * Helper: create a handler with controllable dependencies.
 *
 * - `processFileFn` is a mock that records calls and can be awaited
 * - `existsFn` defaults to always-true
 * - `accessibleFn` defaults to always-true
 * - `stabilityDelayMs` is kept very short for fast tests
 * - `sleepFn` replaces Bun.sleep so tests don't actually wait
 */
function setup(opts: {
  stabilityDelayMs?: number;
  processDelay?: number;
  existsFn?: (p: string) => boolean;
  accessibleFn?: (p: string) => boolean;
  hasTempExtensionFn?: (p: string) => boolean;
}) {
  const calls: string[] = [];
  const stabilityDelayMs = opts.stabilityDelayMs ?? 50;
  const processDelay = opts.processDelay ?? 0;

  const processFileFn = async (path: string) => {
    calls.push(path);
    if (processDelay > 0) {
      await new Promise((r) => setTimeout(r, processDelay));
    }
  };

  // Controllable sleep that actually waits (but short)
  const sleepFn = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const handler = createEventHandler({
    stabilityDelayMs,
    hasTempExtensionFn: opts.hasTempExtensionFn ?? (() => false),
    processFile: processFileFn,
    existsFn: opts.existsFn ?? (() => true),
    accessibleFn: opts.accessibleFn ?? (() => true),
    sleepFn,
    logFn: () => {}, // silent
    retryQueue: { add: () => {} },
  });

  return { handler, calls };
}

function makeEvent(path: string): FileEvent {
  return { type: "created", path };
}

describe("daemon event handler", () => {
  describe("rapid-fire dedup (recentEvents)", () => {
    test("two events for same path within stabilityDelay — only first processes", async () => {
      const { handler, calls } = setup({ stabilityDelayMs: 50 });

      // Fire two events immediately (0ms apart, well within 50ms window)
      handler(makeEvent("/test/file.txt"));
      handler(makeEvent("/test/file.txt"));

      // Wait for processing to complete
      await new Promise((r) => setTimeout(r, 150));

      expect(calls).toEqual(["/test/file.txt"]);
    });

    test("events for different paths both process", async () => {
      const { handler, calls } = setup({ stabilityDelayMs: 50 });

      handler(makeEvent("/test/a.txt"));
      handler(makeEvent("/test/b.txt"));

      await new Promise((r) => setTimeout(r, 150));

      expect(calls).toContain("/test/a.txt");
      expect(calls).toContain("/test/b.txt");
      expect(calls).toHaveLength(2);
    });
  });

  describe("sleep-gap race condition (inFlightPaths)", () => {
    test("two events for same path separated by stabilityDelay+1ms — only first processes", async () => {
      // This is THE bug: two events arrive stabilityDelay+1ms apart,
      // both pass the recentEvents dedup check, both sleep, both process.
      // The inFlightPaths guard should prevent the second from processing.
      const stabilityDelayMs = 50;
      const { handler, calls } = setup({
        stabilityDelayMs,
        processDelay: 100, // processing takes 100ms (longer than stability delay)
      });

      // First event
      handler(makeEvent("/test/file.txt"));

      // Wait stabilityDelay + 1ms so second event passes recentEvents check
      await new Promise((r) => setTimeout(r, stabilityDelayMs + 1));

      // Second event — this WOULD pass recentEvents dedup but should be
      // blocked by inFlightPaths because first is still sleeping/processing
      handler(makeEvent("/test/file.txt"));

      // Wait for everything to complete
      await new Promise((r) => setTimeout(r, stabilityDelayMs + 200));

      expect(calls).toEqual(["/test/file.txt"]);
    });

    test("after processing completes, new event IS processed (inFlightPaths released)", async () => {
      const stabilityDelayMs = 30;
      const processDelay = 20;
      const { handler, calls } = setup({
        stabilityDelayMs,
        processDelay,
      });

      // First event
      handler(makeEvent("/test/file.txt"));

      // Wait for first event to fully complete:
      // stabilityDelay (sleep) + processDelay + buffer
      await new Promise((r) => setTimeout(r, stabilityDelayMs + processDelay + 50));

      // Now fire another event — it should be processed because inFlightPaths was released
      handler(makeEvent("/test/file.txt"));

      // Wait for second to complete
      await new Promise((r) => setTimeout(r, stabilityDelayMs + processDelay + 50));

      expect(calls).toEqual(["/test/file.txt", "/test/file.txt"]);
    });
  });

  describe("inFlightPaths cleanup on error", () => {
    test("path is released from inFlightPaths even if processFile throws", async () => {
      let callCount = 0;
      const calls: string[] = [];
      const stabilityDelayMs = 30;

      const handler = createEventHandler({
        stabilityDelayMs,
        hasTempExtensionFn: () => false,
        processFile: async (path: string) => {
          callCount++;
          if (callCount === 1) {
            throw new Error("simulated failure");
          }
          calls.push(path);
        },
        existsFn: () => true,
        accessibleFn: () => true,
        sleepFn: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        logFn: () => {},
        retryQueue: { add: () => {} },
      });

      // First event — will throw during processFile
      handler(makeEvent("/test/file.txt"));

      // Wait for first event to complete (and fail)
      await new Promise((r) => setTimeout(r, stabilityDelayMs + 50));

      // Second event — should be processed because inFlightPaths was cleaned up via finally
      handler(makeEvent("/test/file.txt"));

      await new Promise((r) => setTimeout(r, stabilityDelayMs + 50));

      expect(callCount).toBe(2);
      expect(calls).toEqual(["/test/file.txt"]);
    });
  });

  describe("temp extension filtering", () => {
    test("skips files with temp extensions", async () => {
      const { handler, calls } = setup({
        stabilityDelayMs: 30,
        hasTempExtensionFn: (p: string) => p.endsWith(".tmp") || p.endsWith(".crdownload"),
      });

      handler(makeEvent("/test/file.tmp"));
      handler(makeEvent("/test/file.crdownload"));

      await new Promise((r) => setTimeout(r, 100));

      expect(calls).toHaveLength(0);
    });
  });

  describe("file existence and accessibility", () => {
    test("skips if file no longer exists after sleep", async () => {
      const { handler, calls } = setup({
        stabilityDelayMs: 30,
        existsFn: () => false,
      });

      handler(makeEvent("/test/gone.txt"));

      await new Promise((r) => setTimeout(r, 100));

      expect(calls).toHaveLength(0);
    });

    test("queues file if not accessible", async () => {
      const queued: string[] = [];
      const handler = createEventHandler({
        stabilityDelayMs: 30,
        hasTempExtensionFn: () => false,
        processFile: async () => {},
        existsFn: () => true,
        accessibleFn: () => false,
        sleepFn: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        logFn: () => {},
        retryQueue: { add: (p: string) => queued.push(p) },
      });

      handler(makeEvent("/test/locked.txt"));

      await new Promise((r) => setTimeout(r, 100));

      expect(queued).toEqual(["/test/locked.txt"]);
    });
  });

  describe("recentEvents cleanup", () => {
    test("handler works correctly with many distinct paths", async () => {
      // This tests that the cleanup logic doesn't crash and handler still works.
      // We can't easily verify internal map size, but we can verify functionality.
      const { handler, calls } = setup({ stabilityDelayMs: 10 });

      // Just verify the handler doesn't crash with many paths
      for (let i = 0; i < 5; i++) {
        handler(makeEvent(`/test/file${i}.txt`));
      }

      await new Promise((r) => setTimeout(r, 100));

      expect(calls).toHaveLength(5);
    });
  });
});
