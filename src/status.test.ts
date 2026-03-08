import { describe, test, expect } from "bun:test";
import { getStatus, type StatusDeps } from "./status";

function createFakeDeps(overrides?: Partial<StatusDeps>): StatusDeps {
  return {
    configPath: "C:\\config\\fileflow.toml",
    watchPaths: ["C:\\Users\\sina\\Downloads", "C:\\Users\\sina\\Desktop"],
    logPath: "C:\\logs\\fileflow.log",
    rulesCount: 11,
    dryRun: false,
    isSchedulerInstalled: () => false,
    ...overrides,
  };
}

describe("getStatus", () => {
  test("includes config path in output", () => {
    const result = getStatus(createFakeDeps());
    expect(result).toContain("C:\\config\\fileflow.toml");
  });

  test("includes all watch paths", () => {
    const result = getStatus(createFakeDeps());
    expect(result).toContain("C:\\Users\\sina\\Downloads");
    expect(result).toContain("C:\\Users\\sina\\Desktop");
  });

  test("includes log path", () => {
    const result = getStatus(createFakeDeps());
    expect(result).toContain("C:\\logs\\fileflow.log");
  });

  test("includes rules count", () => {
    const result = getStatus(createFakeDeps());
    expect(result).toContain("11");
  });

  test("shows dry-run as enabled when true", () => {
    const result = getStatus(createFakeDeps({ dryRun: true }));
    expect(result).toContain("yes");
  });

  test("shows dry-run as disabled when false", () => {
    const result = getStatus(createFakeDeps({ dryRun: false }));
    expect(result).toContain("no");
  });

  test("shows startup task as installed when true", () => {
    const result = getStatus(createFakeDeps({ isSchedulerInstalled: () => true }));
    expect(result).toContain("installed");
  });

  test("shows startup task as not installed when false", () => {
    const result = getStatus(createFakeDeps({ isSchedulerInstalled: () => false }));
    expect(result).toContain("not installed");
  });
});
