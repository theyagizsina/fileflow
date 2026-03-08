import { readFileSync } from "fs";

// ── Type definitions ──────────────────────────────────────────────

export type StepType = "select" | "confirm" | "text";
export type ActionType = "mkdir" | "git_init" | "git_clone" | "shell";

export interface StepOption {
  value: string;
  label: string;
}

export interface StepCondition {
  step: string;
  equals: string | boolean;
}

export interface BlueprintStep {
  id: string;
  prompt: string;
  type: StepType;
  options?: StepOption[];
  default?: string | boolean;
  condition?: StepCondition;
}

export interface BlueprintAction {
  type: ActionType;
  condition?: StepCondition;
  url?: string;
  command?: string;
  args?: string[];
}

export interface Blueprint {
  id: string;
  name: string;
  description?: string;
  steps: BlueprintStep[];
  actions: BlueprintAction[];
}

export interface BlueprintsConfig {
  blueprints: Blueprint[];
}

export type LoadBlueprintsResult =
  | { ok: true; value: BlueprintsConfig }
  | { ok: false; errors: string[] };

// ── Validation constants ──────────────────────────────────────────

const VALID_STEP_TYPES: readonly string[] = ["select", "confirm", "text"];
const VALID_ACTION_TYPES: readonly string[] = ["mkdir", "git_init", "git_clone", "shell"];

// ── Loader / validator ────────────────────────────────────────────

export function loadBlueprints(
  path: string,
  readFileFn: (p: string, enc: string) => string = (p, enc) =>
    readFileSync(p, enc as BufferEncoding),
): LoadBlueprintsResult {
  // 1. Read file
  let raw: string;
  try {
    raw = readFileFn(path, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`Failed to read file: ${msg}`] };
  }

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [`Invalid JSON: ${msg}`] };
  }

  // 3. Validate structure — collect all errors
  const errors: string[] = [];
  const obj = parsed as Record<string, unknown>;

  if (
    !obj ||
    typeof obj !== "object" ||
    !Array.isArray(obj.blueprints)
  ) {
    return { ok: false, errors: ['"blueprints" must be a non-empty array'] };
  }

  const blueprints = obj.blueprints as unknown[];

  if (blueprints.length === 0) {
    return { ok: false, errors: ['"blueprints" must be a non-empty array'] };
  }

  const validatedBlueprints: Blueprint[] = [];

  for (let bi = 0; bi < blueprints.length; bi++) {
    const bp = blueprints[bi] as Record<string, unknown>;
    const prefix = `blueprints[${bi}]`;

    if (!bp || typeof bp !== "object") {
      errors.push(`${prefix}: must be an object`);
      continue;
    }

    // Required string fields
    if (typeof bp.id !== "string" || bp.id.trim() === "") {
      errors.push(`${prefix}: "id" is required and must be a non-empty string`);
    }
    if (typeof bp.name !== "string" || bp.name.trim() === "") {
      errors.push(`${prefix}: "name" is required and must be a non-empty string`);
    }

    // Steps
    if (!Array.isArray(bp.steps)) {
      errors.push(`${prefix}: "steps" is required and must be an array`);
    } else {
      for (let si = 0; si < bp.steps.length; si++) {
        const step = (bp.steps as unknown[])[si] as Record<string, unknown>;
        const sp = `${prefix}.steps[${si}]`;

        if (!step || typeof step !== "object") {
          errors.push(`${sp}: must be an object`);
          continue;
        }

        if (typeof step.id !== "string" || step.id.trim() === "") {
          errors.push(`${sp}: "id" is required and must be a non-empty string`);
        }
        if (typeof step.prompt !== "string" || step.prompt.trim() === "") {
          errors.push(`${sp}: "prompt" is required and must be a non-empty string`);
        }
        if (!VALID_STEP_TYPES.includes(step.type as string)) {
          errors.push(
            `${sp}: "type" must be one of ${VALID_STEP_TYPES.join(", ")}, got "${step.type}"`,
          );
        }

        // select steps require options
        if (step.type === "select") {
          if (!Array.isArray(step.options) || step.options.length === 0) {
            errors.push(`${sp}: "options" is required for select steps and must be a non-empty array`);
          } else {
            for (let oi = 0; oi < (step.options as unknown[]).length; oi++) {
              const opt = (step.options as unknown[])[oi] as Record<string, unknown>;
              const op = `${sp}.options[${oi}]`;
              if (!opt || typeof opt !== "object") {
                errors.push(`${op}: must be an object with "value" and "label"`);
                continue;
              }
              if (typeof opt.value !== "string") {
                errors.push(`${op}: "value" is required and must be a string`);
              }
              if (typeof opt.label !== "string") {
                errors.push(`${op}: "label" is required and must be a string`);
              }
            }
          }
        }
      }
    }

    // Actions
    if (!Array.isArray(bp.actions)) {
      errors.push(`${prefix}: "actions" is required and must be an array`);
    } else {
      for (let ai = 0; ai < bp.actions.length; ai++) {
        const action = (bp.actions as unknown[])[ai] as Record<string, unknown>;
        const ap = `${prefix}.actions[${ai}]`;

        if (!action || typeof action !== "object") {
          errors.push(`${ap}: must be an object`);
          continue;
        }

        if (!VALID_ACTION_TYPES.includes(action.type as string)) {
          errors.push(
            `${ap}: "type" must be one of ${VALID_ACTION_TYPES.join(", ")}, got "${action.type}"`,
          );
        }
      }
    }

    // Build validated blueprint (even with errors, for structure)
    if (errors.length === 0) {
      validatedBlueprints.push({
        id: bp.id as string,
        name: bp.name as string,
        description: typeof bp.description === "string" ? bp.description : undefined,
        steps: (bp.steps as unknown[]).map((s: unknown) => {
          const step = s as Record<string, unknown>;
          const result: BlueprintStep = {
            id: step.id as string,
            prompt: step.prompt as string,
            type: step.type as StepType,
          };
          if (step.options !== undefined) {
            result.options = (step.options as unknown[]).map((o: unknown) => {
              const opt = o as Record<string, unknown>;
              return { value: opt.value as string, label: opt.label as string };
            });
          }
          if (step.default !== undefined) {
            result.default = step.default as string | boolean;
          }
          if (step.condition !== undefined) {
            const cond = step.condition as Record<string, unknown>;
            result.condition = { step: cond.step as string, equals: cond.equals as string | boolean };
          }
          return result;
        }),
        actions: (bp.actions as unknown[]).map((a: unknown) => {
          const action = a as Record<string, unknown>;
          const result: BlueprintAction = { type: action.type as ActionType };
          if (action.condition !== undefined) {
            const cond = action.condition as Record<string, unknown>;
            result.condition = { step: cond.step as string, equals: cond.equals as string | boolean };
          }
          if (action.url !== undefined) result.url = action.url as string;
          if (action.command !== undefined) result.command = action.command as string;
          if (action.args !== undefined) result.args = action.args as string[];
          return result;
        }),
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { blueprints: validatedBlueprints } };
}
