import { basename, extname } from "path";
import { minimatch } from "minimatch";
import type { Rule } from "./config";

export interface ExplainDeps {
  filePath: string;
  rules: Rule[];
  ignoreExtensions: string[];
}

export interface ExplainResult {
  matched: boolean;
  skipped: boolean;
  ruleName?: string;
  destination?: string;
  matchedValue?: string;
  report: string;
}

export function explainFile(deps: ExplainDeps): ExplainResult {
  const name = basename(deps.filePath);
  const ext = extname(name).toLowerCase();
  const lines: string[] = [];

  lines.push(`File: ${name}`);
  lines.push(`Extension: ${ext || "(none)"}`);
  lines.push("");

  // Check if temp extension
  if (ext && deps.ignoreExtensions.some((ie) => ie.toLowerCase() === ext)) {
    lines.push(`Result: SKIPPED — extension '${ext}' is in the ignored extensions list`);
    return {
      matched: false,
      skipped: true,
      report: lines.join("\n"),
    };
  }

  // Walk through rules
  lines.push("Rules evaluated:");
  for (const rule of deps.rules) {
    let matched = false;
    let matchedValue: string | undefined;

    if (rule.type === "extension") {
      for (const m of rule.match) {
        if (ext !== "" && m.toLowerCase() === ext) {
          matched = true;
          matchedValue = m;
          break;
        }
      }
    } else if (rule.type === "pattern") {
      for (const m of rule.match) {
        if (minimatch(name, m, { nocase: true })) {
          matched = true;
          matchedValue = m;
          break;
        }
      }
    }

    if (matched) {
      lines.push(`  [MATCH] '${rule.name}' (${rule.type}) — matched '${matchedValue}' -> ${rule.destination}`);
      lines.push("");
      lines.push(`Result: Matched rule '${rule.name}'`);
      lines.push(`Destination: ${rule.destination}`);
      return {
        matched: true,
        skipped: false,
        ruleName: rule.name,
        destination: rule.destination,
        matchedValue,
        report: lines.join("\n"),
      };
    } else {
      const tried = rule.match.join(", ");
      lines.push(`  [ SKIP ] '${rule.name}' (${rule.type}) — tried [${tried}], no match`);
    }
  }

  lines.push("");
  lines.push("No rule matched this file.");
  return {
    matched: false,
    skipped: false,
    report: lines.join("\n"),
  };
}
