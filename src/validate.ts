import type { Rule } from "./config";

export interface ValidateDeps {
  configPath: string;
  watchPaths: string[];
  rules: Rule[];
  pathExists: (path: string) => boolean;
  isWritable: (path: string) => boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  report: string;
}

export function runValidation(deps: ValidateDeps): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reportLines: string[] = [];

  // 1. Config file loaded (if we got here, it parsed OK)
  reportLines.push(`  Config: ${deps.configPath} ... PASS`);

  // 2. Check watch paths exist
  for (const wp of deps.watchPaths) {
    if (deps.pathExists(wp)) {
      reportLines.push(`  Watch path: ${wp} ... PASS`);
    } else {
      const msg = `Watch path does not exist: ${wp}`;
      errors.push(msg);
      reportLines.push(`  Watch path: ${wp} ... FAIL (does not exist)`);
    }
  }

  // 3. Check rules
  const ruleNameCount = new Map<string, number>();
  for (const rule of deps.rules) {
    ruleNameCount.set(rule.name, (ruleNameCount.get(rule.name) ?? 0) + 1);
  }

  for (const rule of deps.rules) {
    // Check destination exists
    if (!deps.pathExists(rule.destination)) {
      const msg = `Rule '${rule.name}': destination does not exist: ${rule.destination}`;
      errors.push(msg);
      reportLines.push(`  Rule '${rule.name}' destination: ${rule.destination} ... FAIL (does not exist)`);
    } else if (!deps.isWritable(rule.destination)) {
      const msg = `Rule '${rule.name}': destination not writable: ${rule.destination}`;
      errors.push(msg);
      reportLines.push(`  Rule '${rule.name}' destination: ${rule.destination} ... FAIL (not writable)`);
    } else {
      reportLines.push(`  Rule '${rule.name}' destination: ${rule.destination} ... PASS`);
    }

    // Check extension rules have leading dots
    if (rule.type === "extension") {
      for (const m of rule.match) {
        if (!m.startsWith(".")) {
          const msg = `Rule '${rule.name}': extension '${m}' is missing leading dot (should be '.${m}')`;
          warnings.push(msg);
          reportLines.push(`  Rule '${rule.name}' match '${m}' ... WARN (missing leading dot)`);
        }
      }
    }
  }

  // 4. Check duplicate rule names
  for (const [name, count] of ruleNameCount) {
    if (count > 1) {
      const msg = `duplicate rule name '${name}' appears ${count} times`;
      warnings.push(msg);
      reportLines.push(`  Rule names ... WARN (duplicate: '${name}')`);
    }
  }

  const ok = errors.length === 0;
  const header = ok
    ? (warnings.length > 0 ? "FileFlow Validate: PASS (with warnings)" : "FileFlow Validate: PASS")
    : "FileFlow Validate: FAIL";

  const report = [header, "", ...reportLines].join("\n");

  return { ok, errors, warnings, report };
}
