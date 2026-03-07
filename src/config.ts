import { readFileSync } from "fs";
import TOML from "@iarna/toml";

export interface Config {
  watch: { paths: string[] };
  safety: {
    ignore_extensions: string[];
    stability_delay_seconds: number;
    retry_interval_seconds: number;
    max_retries: number;
  };
  logging: {
    path: string;
    max_size_mb: number;
    rotate: boolean;
  };
  notifications: { enabled: boolean };
  rules: Rule[];
}

export interface Rule {
  name: string;
  type: "pattern" | "extension";
  match: string[];
  destination: string;
}

export function expandEnvVars(input: string): string {
  return input.replace(/%([^%]+)%/g, (_, varName) => {
    return process.env[varName] ?? "";
  });
}

export function loadConfig(path: string): Config {
  const content = readFileSync(path, "utf-8");
  const raw = TOML.parse(content) as any;

  return {
    watch: { paths: raw.watch?.paths ?? [] },
    safety: {
      ignore_extensions: raw.safety?.ignore_extensions ?? [],
      stability_delay_seconds: raw.safety?.stability_delay_seconds ?? 3,
      retry_interval_seconds: raw.safety?.retry_interval_seconds ?? 10,
      max_retries: raw.safety?.max_retries ?? 30,
    },
    logging: {
      path: raw.logging?.path ?? "fileflow.log",
      max_size_mb: raw.logging?.max_size_mb ?? 10,
      rotate: raw.logging?.rotate ?? true,
    },
    notifications: { enabled: raw.notifications?.enabled ?? false },
    rules: (raw.rules ?? []).map((r: any) => ({
      name: r.name,
      type: r.type,
      match: r.match,
      destination: r.destination,
    })),
  };
}

export function expandedWatchPaths(config: Config): string[] {
  return config.watch.paths.map(expandEnvVars);
}

export function defaultConfigToml(): string {
  const path = require("path");
  return readFileSync(path.join(__dirname, "..", "default_config.toml"), "utf-8");
}
