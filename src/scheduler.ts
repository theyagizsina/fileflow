import { execSync } from "child_process";

/**
 * Adapter interface for interacting with the OS task scheduler.
 * Production uses schtasks.exe; tests inject a fake.
 */
export interface SchedulerAdapter {
  create(taskName: string, exePath: string, configPath: string): void;
  remove(taskName: string): void;
  exists(taskName: string): boolean;
}

/**
 * Function signature for executing shell commands.
 * Production uses execSync; tests inject a fake.
 */
export type ExecFn = (cmd: string) => string;

const TASK_NAME = "FileFlow";

const defaultExec: ExecFn = (cmd) => execSync(cmd, { encoding: "utf-8" });

/**
 * Create a SchedulerAdapter that uses Windows schtasks.exe.
 * Accepts an optional exec function for testing.
 */
export function createSchtasksAdapter(exec: ExecFn = defaultExec): SchedulerAdapter {
  return {
    create(taskName: string, exePath: string, configPath: string): void {
      exec(
        `schtasks /Create /TN "${taskName}" /TR "\\"${exePath}\\" --config \\"${configPath}\\"" /SC ONLOGON /RL LIMITED /F`
      );
    },
    remove(taskName: string): void {
      exec(`schtasks /Delete /TN "${taskName}" /F`);
    },
    exists(taskName: string): boolean {
      try {
        exec(`schtasks /Query /TN "${taskName}"`);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function installStartupTask(opts: {
  exePath: string;
  configPath: string;
  adapter: SchedulerAdapter;
}): string {
  opts.adapter.create(TASK_NAME, opts.exePath, opts.configPath);
  return `FileFlow startup task installed. It will run at user logon.`;
}

export function uninstallStartupTask(opts: {
  adapter: SchedulerAdapter;
}): string {
  opts.adapter.remove(TASK_NAME);
  return `FileFlow startup task uninstalled.`;
}

export function isInstalled(opts: {
  adapter: SchedulerAdapter;
}): boolean {
  return opts.adapter.exists(TASK_NAME);
}
