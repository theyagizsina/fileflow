import type { FileEvent } from "./watcher";

export interface EventHandlerDeps {
  stabilityDelayMs: number;
  hasTempExtensionFn: (path: string) => boolean;
  processFile: (path: string) => void | Promise<void>;
  existsFn: (path: string) => boolean;
  accessibleFn: (path: string) => boolean;
  sleepFn: (ms: number) => Promise<void>;
  logFn: (level: string, message: string) => void;
  retryQueue: { add: (path: string) => void };
}

export function createEventHandler(deps: EventHandlerDeps): (event: FileEvent) => void {
  const {
    stabilityDelayMs,
    hasTempExtensionFn,
    processFile,
    existsFn,
    accessibleFn,
    sleepFn,
    logFn,
    retryQueue,
  } = deps;

  // Deduplicate rapid-fire events (fs.watch fires multiple times per file)
  const recentEvents = new Map<string, number>();

  // Guard against sleep-gap race: block concurrent processing of same path
  const inFlightPaths = new Set<string>();

  return (event: FileEvent) => {
    const now = Date.now();
    const lastSeen = recentEvents.get(event.path);
    if (lastSeen && now - lastSeen < stabilityDelayMs) return;
    recentEvents.set(event.path, now);

    // Clean old entries periodically
    if (recentEvents.size > 1000) {
      for (const [key, time] of recentEvents) {
        if (now - time > 60000) recentEvents.delete(key);
      }
    }

    // Check temp extensions before acquiring in-flight lock
    if (hasTempExtensionFn(event.path)) {
      logFn("info", `SKIPPED ${event.path} (reason: temp_extension)`);
      return;
    }

    // In-flight guard: if this path is already being processed, skip
    if (inFlightPaths.has(event.path)) return;
    inFlightPaths.add(event.path);

    // Process asynchronously with try/finally to ensure cleanup
    (async () => {
      try {
        // Stability delay
        await sleepFn(stabilityDelayMs);

        if (!existsFn(event.path)) return;

        if (accessibleFn(event.path)) {
          await processFile(event.path);
        } else {
          logFn("info", `QUEUED ${event.path} (reason: file_locked)`);
          retryQueue.add(event.path);
        }
      } catch (e) {
        logFn("error", `FAILED processing ${event.path}: ${e}`);
      } finally {
        inFlightPaths.delete(event.path);
      }
    })();
  };
}
