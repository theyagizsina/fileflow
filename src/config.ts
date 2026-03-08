import { readFileSync } from "fs";
import { join } from "path";
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
  projects?: {
    root: string;
    blueprints?: string;
    allowed_commands?: string[];
  };
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

  // Projects validation
  if (raw.projects !== undefined) {
    if (typeof raw.projects.root !== "string" || raw.projects.root.trim() === "") {
      throw new Error("projects.root must be a non-empty string");
    }
    if (
      raw.projects.blueprints !== undefined &&
      (typeof raw.projects.blueprints !== "string" || raw.projects.blueprints.trim() === "")
    ) {
      throw new Error("projects.blueprints must be a non-empty string");
    }
    if (
      raw.projects.allowed_commands !== undefined &&
      (!Array.isArray(raw.projects.allowed_commands) ||
        !raw.projects.allowed_commands.every((c: unknown) => typeof c === "string"))
    ) {
      throw new Error("projects.allowed_commands must be an array of strings");
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
    projects: raw.projects
      ? {
          root: expandEnvVars(raw.projects.root),
          blueprints: raw.projects.blueprints,
          allowed_commands: raw.projects.allowed_commands,
        }
      : undefined,
  };
}

export function expandedWatchPaths(config: Config): string[] {
  return config.watch.paths.map(expandEnvVars);
}

export function defaultConfigToml(): string {
  return `[watch]
paths = [
  "%USERPROFILE%\\\\Downloads",
  "%USERPROFILE%\\\\Desktop"
]

[safety]
ignore_extensions = [".tmp", ".crdownload", ".part", ".partial", ".download", ".opdownload"]
stability_delay_seconds = 3
retry_interval_seconds = 10
max_retries = 30

[logging]
path = "%LOCALAPPDATA%\\\\FileFlow\\\\fileflow.log"
max_size_mb = 10
rotate = true

[notifications]
enabled = false

# --- Rules ---
# Rules are evaluated top to bottom. First match wins.
# Types: "pattern" (filename glob) or "extension"

[[rules]]
name = "Screenshots"
type = "pattern"
match = ["Screenshot*", "Screen Shot*", "Ekran g\\u00F6r\\u00FCnt\\u00FCs\\u00FC*", "Clipboard*", "Snipaste*", "ShareX*", "Lightshot*", "Greenshot*"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Media\\\\Screenshots"

[[rules]]
name = "Photos"
type = "pattern"
match = ["IMG_*", "DSC_*", "DCIM*", "PXL_*", "DSCF*", "Photo*"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Media\\\\Images"

[[rules]]
name = "Design Files"
type = "extension"
match = [".fig", ".xd", ".sketch", ".psd", ".ai", ".indd", ".afdesign", ".afphoto"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Design"

[[rules]]
name = "Videos"
type = "extension"
match = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Media\\\\Videos"

[[rules]]
name = "Audio"
type = "extension"
match = [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Media\\\\Audio"

[[rules]]
name = "Images"
type = "extension"
match = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg", ".ico", ".raw", ".cr2", ".nef"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Media\\\\Images"

[[rules]]
name = "Documents"
type = "extension"
match = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".txt", ".rtf", ".csv"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Downloads\\\\Documents"

[[rules]]
name = "Archives"
type = "extension"
match = [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Downloads\\\\Archives"

[[rules]]
name = "Code"
type = "extension"
match = [".js", ".ts", ".py", ".html", ".css", ".json", ".yaml", ".yml", ".xml", ".sql", ".sh", ".bat", ".ps1", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".php", ".swift", ".kt", ".lua", ".r", ".md"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Downloads\\\\Code"

[[rules]]
name = "Fonts"
type = "extension"
match = [".ttf", ".otf", ".woff", ".woff2", ".eot"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Downloads\\\\Fonts"

[[rules]]
name = "Setup"
type = "extension"
match = [".exe", ".msi", ".appx", ".msix", ".iso", ".img"]
destination = "%USERPROFILE%\\\\FileFlow\\\\Downloads\\\\Setup"
`;
}

export function resolveConfigPath(
  explicit: string | undefined,
  existsFn: (path: string) => boolean,
  appdata?: string,
): string {
  if (explicit) return explicit;

  const base = appdata ?? process.env.APPDATA ?? "";
  if (base) {
    const standard = join(base, "FileFlow", "fileflow.toml");
    if (existsFn(standard)) return standard;
  }

  return "fileflow.toml";
}
