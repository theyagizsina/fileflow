export interface StatusDeps {
  configPath: string;
  watchPaths: string[];
  logPath: string;
  rulesCount: number;
  dryRun: boolean;
  isSchedulerInstalled: () => boolean;
}

export function getStatus(deps: StatusDeps): string {
  const lines: string[] = [
    `FileFlow Status`,
    `───────────────────────────────`,
    `Config:         ${deps.configPath}`,
    `Log:            ${deps.logPath}`,
    `Rules:          ${deps.rulesCount}`,
    `Dry-run:        ${deps.dryRun ? "yes" : "no"}`,
    `Startup task:   ${deps.isSchedulerInstalled() ? "installed" : "not installed"}`,
    `Watch paths:`,
    ...deps.watchPaths.map((p) => `  - ${p}`),
  ];
  return lines.join("\n");
}
