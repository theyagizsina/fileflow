import { join } from "path";
import type { Blueprint, BlueprintAction, BlueprintsConfig } from "./blueprints";

// ── Dependency injection interfaces ──────────────────────────────

export interface PromptAdapter {
  select(prompt: string, options: { value: string; label: string }[]): Promise<string>;
  text(prompt: string, defaultValue?: string): Promise<string>;
  confirm(prompt: string, defaultValue?: boolean): Promise<boolean>;
}

export interface FsAdapter {
  exists(path: string): boolean;
  mkdir(path: string): void;
}

export interface ExecAdapter {
  run(command: string, args: string[], cwd: string): Promise<{ exitCode: number; output: string }>;
}

// ── Options & result types ───────────────────────────────────────

export interface CreateProjectOptions {
  projectName: string;
  projectsRoot: string;
  blueprints?: BlueprintsConfig;
  yes?: boolean;
  allowedCommands?: string[];
  prompt: PromptAdapter;
  fs: FsAdapter;
  exec: ExecAdapter;
}

export interface ActionResult {
  action: string;
  success: boolean;
}

export interface CreateSummary {
  projectPath: string;
  blueprintName: string;
  actions: ActionResult[];
  success: boolean;
}

// ── Interpolation helper ─────────────────────────────────────────

export function interpolate(input: string, answers: Record<string, unknown>): string {
  return input.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, key: string) => String(answers[key] ?? ""));
}

// ── Default allowed commands ─────────────────────────────────────

const DEFAULT_ALLOWED_COMMANDS = ["git", "bun", "npm", "node", "pnpm", "yarn"];

// ── Fallback blueprint ───────────────────────────────────────────

const FALLBACK_BLUEPRINT: Blueprint = {
  id: "_fallback",
  name: "Custom Project",
  steps: [
    {
      id: "project_type",
      prompt: "Project type name:",
      type: "text",
      default: "general",
    },
    {
      id: "git_strategy",
      prompt: "Git strategy:",
      type: "select",
      options: [
        { value: "init", label: "Initialize new repository" },
        { value: "clone", label: "Clone existing repository" },
        { value: "none", label: "No git" },
      ],
      default: "init",
    },
    {
      id: "repo_url",
      prompt: "Repository URL:",
      type: "text",
      condition: { step: "git_strategy", equals: "clone" },
    },
  ],
  actions: [
    { type: "mkdir" },
    { type: "git_init", condition: { step: "git_strategy", equals: "init" } },
    { type: "git_clone", url: "{{repo_url}}", condition: { step: "git_strategy", equals: "clone" } },
  ],
};

// ── Condition checker ────────────────────────────────────────────

function isConditionMet(
  condition: { step: string; equals: string | boolean } | undefined,
  answers: Record<string, unknown>,
): boolean {
  if (!condition) return true;
  return answers[condition.step] === condition.equals;
}

// ── Action execution ─────────────────────────────────────────────

async function executeAction(
  action: BlueprintAction,
  targetPath: string,
  answers: Record<string, unknown>,
  opts: CreateProjectOptions,
  dirCreated: { value: boolean },
): Promise<ActionResult> {
  switch (action.type) {
    case "mkdir": {
      opts.fs.mkdir(targetPath);
      dirCreated.value = true;
      return { action: "Created directory", success: true };
    }

    case "git_init": {
      if (!dirCreated.value) {
        opts.fs.mkdir(targetPath);
        dirCreated.value = true;
      }
      const result = await opts.exec.run("git", ["init"], targetPath);
      if (result.exitCode !== 0) {
        return { action: `git init failed: ${result.output}`, success: false };
      }
      return { action: "Initialized git", success: true };
    }

    case "git_clone": {
      if (!dirCreated.value) {
        opts.fs.mkdir(targetPath);
        dirCreated.value = true;
      }
      const url = interpolate(action.url ?? "", answers);
      const result = await opts.exec.run("git", ["clone", url, "."], targetPath);
      if (result.exitCode !== 0) {
        return { action: `git clone failed: ${result.output}`, success: false };
      }
      return { action: "Cloned repository", success: true };
    }

    case "shell": {
      if (!action.command) {
        return { action: "shell: missing command", success: false };
      }
      const command = action.command;
      const allowedCommands = opts.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS;

      if (!allowedCommands.includes(command)) {
        throw new Error(
          `Command not allowed: ${command}. Allowed: ${allowedCommands.join(", ")}`,
        );
      }

      const interpolatedArgs = (action.args ?? []).map((a) => interpolate(a, answers));

      if (!opts.yes) {
        const confirmed = await opts.prompt.confirm(
          `Run: ${command} ${interpolatedArgs.join(" ")}?`,
        );
        if (!confirmed) {
          return { action: `Skipped: ${command}`, success: true };
        }
      }

      const result = await opts.exec.run(command, interpolatedArgs, targetPath);
      if (result.exitCode !== 0) {
        return { action: `${command} failed: ${result.output}`, success: false };
      }
      return { action: `Ran ${command}`, success: true };
    }

    default: {
      return { action: `Unknown action: ${action.type}`, success: false };
    }
  }
}

// ── Main flow ────────────────────────────────────────────────────

export async function runCreateFlow(opts: CreateProjectOptions): Promise<CreateSummary> {
  const targetPath = join(opts.projectsRoot, opts.projectName);

  // 1. Check target doesn't already exist
  if (opts.fs.exists(targetPath)) {
    throw new Error(`already exists: ${targetPath}`);
  }

  // 2. Select blueprint
  let selectedBlueprint: Blueprint;

  const hasBlueprints =
    opts.blueprints &&
    opts.blueprints.blueprints &&
    opts.blueprints.blueprints.length > 0;

  if (hasBlueprints) {
    const blueprintOptions = opts.blueprints!.blueprints.map((bp) => ({
      value: bp.id,
      label: bp.name,
    }));

    const selectedId = await opts.prompt.select("Select a blueprint:", blueprintOptions);
    const found = opts.blueprints!.blueprints.find((bp) => bp.id === selectedId);

    if (!found) {
      throw new Error(`Blueprint not found: ${selectedId}`);
    }

    selectedBlueprint = found;
  } else {
    selectedBlueprint = FALLBACK_BLUEPRINT;
  }

  // 3. Ask step-by-step questions
  const answers: Record<string, unknown> = {};

  for (const step of selectedBlueprint.steps) {
    if (!isConditionMet(step.condition, answers)) {
      continue;
    }

    switch (step.type) {
      case "select": {
        answers[step.id] = await opts.prompt.select(step.prompt, step.options!);
        break;
      }
      case "text": {
        answers[step.id] = await opts.prompt.text(
          step.prompt,
          step.default as string | undefined,
        );
        break;
      }
      case "confirm": {
        answers[step.id] = await opts.prompt.confirm(
          step.prompt,
          step.default as boolean | undefined,
        );
        break;
      }
    }
  }

  // 4. Execute actions
  const actionResults: ActionResult[] = [];
  const dirCreated = { value: false };

  for (const action of selectedBlueprint.actions) {
    if (!isConditionMet(action.condition, answers)) {
      continue;
    }

    const result = await executeAction(action, targetPath, answers, opts, dirCreated);
    actionResults.push(result);
  }

  // 5. Return summary
  const success = actionResults.every(r => r.success);
  return {
    projectPath: targetPath,
    blueprintName: selectedBlueprint.name,
    actions: actionResults,
    success,
  };
}
