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

export function validateConfig(raw: any): void {
  // Watch paths validation
  const paths = raw.watch?.paths;
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("watch.paths must be a non-empty array");
  }

  // Safety numeric validation
  const safety = raw.safety ?? {};
  if (safety.stability_delay_seconds !== undefined) {
    if (typeof safety.stability_delay_seconds !== "number" || safety.stability_delay_seconds < 0) {
      throw new Error(`stability_delay_seconds must be a non-negative number, got ${safety.stability_delay_seconds}`);
    }
  }
  if (safety.retry_interval_seconds !== undefined) {
    if (typeof safety.retry_interval_seconds !== "number" || safety.retry_interval_seconds < 0) {
      throw new Error(`retry_interval_seconds must be a non-negative number, got ${safety.retry_interval_seconds}`);
    }
  }
  if (safety.max_retries !== undefined) {
    if (typeof safety.max_retries !== "number" || !Number.isInteger(safety.max_retries) || safety.max_retries < 0) {
      throw new Error(`max_retries must be a non-negative integer, got ${safety.max_retries}`);
    }
  }

  // Rules validation
  const rules = raw.rules ?? [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];

    if (!r.name || typeof r.name !== "string") {
      throw new Error(`Rule at index ${i} is missing required field 'name'`);
    }

    if (r.type !== "pattern" && r.type !== "extension") {
      throw new Error(`Rule '${r.name}' has invalid type '${r.type}', expected 'pattern' or 'extension'`);
    }

    if (!Array.isArray(r.match) || r.match.length === 0) {
      throw new Error(`Rule '${r.name}' has empty 'match' array`);
    }

    if (r.destination === undefined || r.destination === null || typeof r.destination !== "string") {
      throw new Error(`Rule '${r.name}' is missing required field 'destination'`);
    }

    if (r.destination.trim() === "") {
      throw new Error(`Rule '${r.name}' has empty 'destination'`);
    }
  }
}

export function loadConfig(path: string): Config {
  const content = readFileSync(path, "utf-8");
  const raw = TOML.parse(content) as any;

  validateConfig(raw);

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
      destination: expandEnvVars(r.destination),
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
