import { describe, test, expect, beforeEach } from "bun:test";
import {
  installStartupTask,
  uninstallStartupTask,
  isInstalled,
  createSchtasksAdapter,
  type SchedulerAdapter,
  type ExecFn,
} from "./scheduler";

/**
 * Fake adapter that records calls instead of touching real Task Scheduler.
 */
function createFakeAdapter(): SchedulerAdapter & {
  calls: { method: string; args: string[] }[];
  queryResult: boolean;
} {
  const adapter = {
    calls: [] as { method: string; args: string[] }[],
    queryResult: false,
    create(taskName: string, exePath: string, configPath: string): void {
      adapter.calls.push({ method: "create", args: [taskName, exePath, configPath] });
    },
    remove(taskName: string): void {
      adapter.calls.push({ method: "remove", args: [taskName] });
    },
    exists(taskName: string): boolean {
      adapter.calls.push({ method: "exists", args: [taskName] });
      return adapter.queryResult;
    },
  };
  return adapter;
}

describe("scheduler", () => {
  let adapter: ReturnType<typeof createFakeAdapter>;

  beforeEach(() => {
    adapter = createFakeAdapter();
  });

  describe("installStartupTask", () => {
    test("calls adapter.create with correct task name, exe path, and config path", () => {
      installStartupTask({
        exePath: "C:\\Program Files\\fileflow.exe",
        configPath: "C:\\config\\fileflow.toml",
        adapter,
      });

      expect(adapter.calls).toHaveLength(1);
      expect(adapter.calls[0]!.method).toBe("create");
      expect(adapter.calls[0]!.args).toEqual([
        "FileFlow",
        "C:\\Program Files\\fileflow.exe",
        "C:\\config\\fileflow.toml",
      ]);
    });

    test("returns success message", () => {
      const result = installStartupTask({
        exePath: "C:\\fileflow.exe",
        configPath: "C:\\fileflow.toml",
        adapter,
      });

      expect(result).toContain("installed");
    });

    test("throws if adapter.create throws", () => {
      const failAdapter: SchedulerAdapter = {
        create() { throw new Error("access denied"); },
        remove() {},
        exists() { return false; },
      };

      expect(() =>
        installStartupTask({
          exePath: "C:\\fileflow.exe",
          configPath: "C:\\fileflow.toml",
          adapter: failAdapter,
        })
      ).toThrow("access denied");
    });
  });

  describe("uninstallStartupTask", () => {
    test("calls adapter.remove with correct task name", () => {
      uninstallStartupTask({ adapter });

      expect(adapter.calls).toHaveLength(1);
      expect(adapter.calls[0]!.method).toBe("remove");
      expect(adapter.calls[0]!.args).toEqual(["FileFlow"]);
    });

    test("returns success message", () => {
      const result = uninstallStartupTask({ adapter });
      expect(result).toContain("uninstalled");
    });

    test("throws if adapter.remove throws", () => {
      const failAdapter: SchedulerAdapter = {
        create() {},
        remove() { throw new Error("task not found"); },
        exists() { return false; },
      };

      expect(() => uninstallStartupTask({ adapter: failAdapter })).toThrow("task not found");
    });
  });

  describe("isInstalled", () => {
    test("returns true when adapter.exists returns true", () => {
      adapter.queryResult = true;
      expect(isInstalled({ adapter })).toBe(true);
    });

    test("returns false when adapter.exists returns false", () => {
      adapter.queryResult = false;
      expect(isInstalled({ adapter })).toBe(false);
    });
  });
});

describe("schtasksAdapter", () => {
  test("create calls schtasks with correct arguments", () => {
    const calls: string[] = [];
    const fakeExec: ExecFn = (cmd) => { calls.push(cmd); return ""; };
    const adapter = createSchtasksAdapter(fakeExec);

    adapter.create("FileFlow", "C:\\fileflow.exe", "C:\\config.toml");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("schtasks /Create");
    expect(calls[0]).toContain("/TN \"FileFlow\"");
    expect(calls[0]).toContain("C:\\fileflow.exe");
    expect(calls[0]).toContain("C:\\config.toml");
    expect(calls[0]).toContain("/SC ONLOGON");
  });

  test("remove calls schtasks /Delete", () => {
    const calls: string[] = [];
    const fakeExec: ExecFn = (cmd) => { calls.push(cmd); return ""; };
    const adapter = createSchtasksAdapter(fakeExec);

    adapter.remove("FileFlow");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("schtasks /Delete");
    expect(calls[0]).toContain("/TN \"FileFlow\"");
    expect(calls[0]).toContain("/F");
  });

  test("exists returns true when schtasks query succeeds", () => {
    const fakeExec: ExecFn = () => "TaskName: FileFlow";
    const adapter = createSchtasksAdapter(fakeExec);

    expect(adapter.exists("FileFlow")).toBe(true);
  });

  test("exists returns false when schtasks query throws", () => {
    const fakeExec: ExecFn = () => { throw new Error("ERROR: The system cannot find the file specified."); };
    const adapter = createSchtasksAdapter(fakeExec);

    expect(adapter.exists("FileFlow")).toBe(false);
  });
});
