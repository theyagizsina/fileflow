import { minimatch } from "minimatch";
import { extname, basename } from "path";
import type { Rule } from "./config";

export type { Rule };

export interface ClassifyResult {
  ruleName: string;
  destination: string;
}

export class Classifier {
  constructor(private rules: Rule[]) {}

  classify(fileName: string): ClassifyResult | null {
    const name = basename(fileName);
    const ext = extname(name).toLowerCase();

    for (const rule of this.rules) {
      let matched = false;

      if (rule.type === "pattern") {
        matched = rule.match.some((pattern) =>
          minimatch(name, pattern, { nocase: true })
        );
      } else if (rule.type === "extension") {
        matched = ext !== "" && rule.match.some((e) => e.toLowerCase() === ext);
      }

      if (matched) {
        return { ruleName: rule.name, destination: rule.destination };
      }
    }

    return null;
  }
}
