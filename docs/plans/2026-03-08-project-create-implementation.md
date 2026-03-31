# Project Create Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `fileflow create <project-name>` workflow that creates projects under `[projects].root`, supports JSON blueprint-driven decision flows, and falls back to interactive defaults when blueprint config is missing or invalid.

**Architecture:** Keep `src/index.ts` as CLI entrypoint, extend `src/config.ts` with a `projects` section, and introduce a new creator engine that executes declarative blueprint `steps` and `actions`. Blueprint definitions live in JSON and are validated by a schema-aware runtime validator, with a safe fallback interactive flow. Action execution remains explicit (`mkdir`, `git_init`, `git_clone`, `shell`) and dependency-injected for testability.

**Tech Stack:** Bun + TypeScript, Node `readline/promises` for prompts, Node `fs/path`, existing `bun:test` test suite.

---

### Task 1: Extend main config with `[projects]`

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

**Step 1: Write failing tests for projects config parsing**

Add tests in `src/config.test.ts`:

```ts
test("parses [projects] root and blueprints", () => {
  const load = loadToml(`
[watch]
paths = ["C:\\\\Downloads"]

[logging]
path = "fileflow.log"

[projects]
root = "%USERPROFILE%\\\\Projects"
blueprints = "project-blueprints.json"
`);
  const config = load();
  expect(config.projects?.root).toContain("Projects");
  expect(config.projects?.blueprints).toBe("project-blueprints.json");
});

test("throws when [projects] exists without root", () => {
  const load = loadToml(`
[watch]
paths = ["C:\\\\Downloads"]

[logging]
path = "fileflow.log"

[projects]
blueprints = "project-blueprints.json"
`);
  expect(load).toThrow(/projects\.root must be a non-empty string/);
});
```

**Step 2: Run tests and confirm failure**

Run: `bun test src/config.test.ts`
Expected: FAIL because `projects` fields are not defined/validated yet.

**Step 3: Implement projects config model and validation**

Update `src/config.ts`:

```ts
export interface Config {
  // existing fields
  projects?: {
    root: string;
    blueprints?: string;
    allowed_commands?: string[];
  };
}

// in validateConfig(raw)
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
}

// in loadConfig return object
projects:
  raw.projects
    ? {
        root: expandEnvVars(raw.projects.root),
        blueprints: raw.projects.blueprints,
        allowed_commands: raw.projects.allowed_commands ?? undefined,
      }
    : undefined,
```

**Step 4: Re-run tests and confirm pass**

Run: `bun test src/config.test.ts`
Expected: PASS including new projects tests.

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "Add projects section to config model" -m "Extends TOML parsing/validation with [projects] root and optional blueprint settings for project creation flow."
```

---

### Task 2: Add blueprint schema and loader/validator module

**Files:**
- Create: `project-blueprints.schema.json`
- Create: `src/blueprints.ts`
- Create: `src/blueprints.test.ts`

**Step 1: Write failing tests for blueprint loading and validation**

Create `src/blueprints.test.ts` with cases:

```ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { loadBlueprints } from "./blueprints";

describe("loadBlueprints", () => {
  test("loads valid blueprints JSON", () => {
    // create temp file with valid structure
    // expect blueprints.length > 0
  });

  test("returns invalid result for malformed JSON", () => {
    // expect ok=false and helpful error
  });

  test("returns invalid result when required fields missing", () => {
    // missing blueprints or step.id
  });
});
```

**Step 2: Run tests and confirm failure**

Run: `bun test src/blueprints.test.ts`
Expected: FAIL because module does not exist.

**Step 3: Implement schema file and runtime validator**

Create `project-blueprints.schema.json` with required shape:

- root: `$schema`, `projectsRoot?`, `allowedCommands?`, `blueprints`
- blueprint: `id`, `name`, `steps`, `actions`
- step: `id`, `prompt`, `type`, `options?`, `default?`, `condition?`
- action: `type`, plus action-specific fields (`url`, `command`, `args`)

Create `src/blueprints.ts`:

```ts
export type StepType = "select" | "confirm" | "text";
export type ActionType = "mkdir" | "git_init" | "git_clone" | "shell";

export interface LoadBlueprintsResult {
  ok: boolean;
  value?: BlueprintsConfig;
  errors?: string[];
}

export function loadBlueprints(path: string, readFileFn = readFileSync): LoadBlueprintsResult {
  // parse JSON
  // validate required fields with explicit checks
  // return structured errors
}
```

Validation rule: keep it deterministic and explicit (manual checks), while shipping JSON schema for AI/tooling standardization.

**Step 4: Re-run tests and confirm pass**

Run: `bun test src/blueprints.test.ts`
Expected: PASS for valid/malformed/invalid-shape scenarios.

**Step 5: Commit**

```bash
git add project-blueprints.schema.json src/blueprints.ts src/blueprints.test.ts
git commit -m "Add project blueprints schema and loader" -m "Introduces JSON blueprint contract and runtime validation with structured errors for safe config-driven project creation."
```

---

### Task 3: Implement creator engine with fallback prompt flow

**Files:**
- Create: `src/creator.ts`
- Create: `src/creator.test.ts`

**Step 1: Write failing tests for decision engine and action execution**

Create `src/creator.test.ts` with dependency injection for prompts/commands:

```ts
import { describe, test, expect } from "bun:test";
import { runCreateFlow } from "./creator";

test("runs mkdir + git_init for init strategy", async () => {
  // fake prompt answers and fake exec collector
  // expect calls: mkdir, git init
});

test("runs git clone with interpolated repo_url", async () => {
  // expect git clone <url> .
});

test("uses fallback questions when no blueprints available", async () => {
  // expect fallback branch and actions
});

test("skips conditional steps when condition is unmet", async () => {
  // repo_url question skipped unless git_strategy=clone
});
```

**Step 2: Run tests and confirm failure**

Run: `bun test src/creator.test.ts`
Expected: FAIL because module does not exist.

**Step 3: Implement creator flow and actions**

Create `src/creator.ts` with APIs:

```ts
export interface CreateProjectOptions {
  projectName: string;
  projectsRoot: string;
  blueprints?: BlueprintsConfig;
  yes?: boolean;
  allowedCommands?: string[];
  prompt: PromptAdapter;
  fsOps: FsAdapter;
  exec: ExecAdapter;
}

export async function runCreateFlow(opts: CreateProjectOptions): Promise<CreateSummary> {
  // resolve target path
  // fail if exists
  // select blueprint or fallback
  // ask conditional steps
  // execute actions in order
  // return summary
}
```

Implement action semantics:

- `mkdir` -> create target directory
- `git_init` -> run `git init` in target directory
- `git_clone` -> run `git clone <url> .` in target directory
- `shell` -> whitelist check + confirmation (unless `yes`)

Interpolation helper:

```ts
function interpolate(input: string, answers: Record<string, unknown>): string {
  return input.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, key) => String(answers[key] ?? ""));
}
```

**Step 4: Re-run tests and confirm pass**

Run: `bun test src/creator.test.ts`
Expected: PASS for flow, condition, interpolation, and fallback cases.

**Step 5: Commit**

```bash
git add src/creator.ts src/creator.test.ts
git commit -m "Add project creator flow engine" -m "Implements config-driven step/action orchestration with fallback prompts and safe action execution for create command."
```

---

### Task 4: Wire `create` command into CLI entrypoint

**Files:**
- Modify: `src/index.ts`

**Step 1: Write failing integration-style CLI tests**

Update `tests/integration.test.ts` with create command coverage (using temp config):

```ts
test("create command fails with missing projects.root", async () => {
  // run CLI with config lacking [projects]
  // expect exit code 1 and guidance message
});
```

If full integration coverage is heavy, add focused unit in `src/index-create.test.ts` for argument routing.

**Step 2: Run tests and confirm failure**

Run: `bun test tests/integration.test.ts`
Expected: FAIL because `create` is not recognized.

**Step 3: Implement command routing in `src/index.ts`**

Use positional arguments from `parseArgs(..., { allowPositionals: true })`.

Pseudo-implementation:

```ts
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    // existing flags
    yes: { type: "boolean", default: false },
  },
});

const cmd = positionals[0];
if (cmd === "create") {
  const projectName = positionals[1];
  // validate name present
  // load main config
  // require config.projects.root
  // load blueprints (optional)
  // run creator engine
  // print summary
  process.exit(0);
}
```

Update help text with:

- `create <name>      Create a new project under projects.root`
- `--yes              Auto-confirm shell actions`

**Step 4: Re-run tests and confirm pass**

Run: `bun test tests/integration.test.ts`
Expected: PASS including new create-related test(s).

**Step 5: Commit**

```bash
git add src/index.ts tests/integration.test.ts
git commit -m "Wire create command into CLI" -m "Adds positional create command routing, projects.root validation, blueprint loading, and summary output in the main CLI entrypoint."
```

---

### Task 5: Add docs and sample blueprint file

**Files:**
- Create: `docs/project-creator.md`
- Create: `project-blueprints.json`
- Modify: `README.md`

**Step 1: Write failing doc expectation test (optional lightweight)**

Optional if this repo avoids docs tests: skip to implementation.

**Step 2: Add user docs with JSON contract examples**

In `docs/project-creator.md` include:

- where to configure `[projects]` in `fileflow.toml`
- how `project-blueprints.json` is discovered
- schema usage and validation expectations
- example `software` blueprint with `git_strategy`
- safety model for `shell`

Add sample `project-blueprints.json` minimal runnable config.

Update `README.md` CLI section with `create <name>` and link to docs.

**Step 3: Verify docs references manually**

Run: `bun run src/index.ts --help`
Expected: help includes create command and `--yes`.

**Step 4: Commit**

```bash
git add docs/project-creator.md project-blueprints.json README.md
git commit -m "Document project creator blueprint system" -m "Adds user docs, sample blueprint JSON, and README updates for config-driven project creation workflow."
```

---

### Task 6: Full verification before completion

**Files:**
- Verify only (no new files required)

**Step 1: Run targeted tests**

Run:

`bun test src/config.test.ts src/blueprints.test.ts src/creator.test.ts`

Expected: PASS.

**Step 2: Run full suite**

Run: `bun test`
Expected: all tests pass.

**Step 3: Run type-check**

Run: `bunx tsc --noEmit`
Expected: no type errors.

**Step 4: Smoke-check CLI help**

Run: `bun run src/index.ts --help`
Expected: includes `create <name>` and `--yes` descriptions.

**Step 5: Final commit (if any uncommitted fixes remain)**

```bash
git add .
git commit -m "Finalize create command with tests and docs"
```
