# Project Create Command Design

## Problem

FileFlow currently manages file organization, but it does not provide a project creation workflow similar to `npx create-react-app`. The user wants a CLI flow that helps create new projects under a dedicated root folder with project-type-specific decisions.

The workflow must be highly customizable and AI-friendly, so project types and decision trees should be represented in a standardized machine-readable format.

## Goals

- Add `fileflow create <project-name>` command.
- Create projects under a configured root directory from main config.
- Support project-type-based interactive decision flows.
- Support config-driven behavior first, with interactive fallback when config is missing or incomplete.
- Standardize customization with JSON + JSON Schema for easy AI authoring and validation.

## Non-Goals

- Generate full starter folder/file templates by default.
- Build language/framework-specific scaffolding logic in core CLI.
- Implement remote registry/distribution of blueprints.

## Constraints

- Main project configuration is TOML (`fileflow.toml`).
- Blueprint customization format is JSON.
- The flow should stay safe and predictable for shell execution.

## Design

### CLI Surface

Add a command form:

`fileflow create <project-name>`

Behavior:

1. Read `projects` settings from `fileflow.toml`.
2. Resolve target path as `{projects.root}/{project-name}`.
3. Load blueprint JSON configuration if available.
4. Ask project-type and step questions.
5. Execute selected actions.
6. Print summary and next steps.

### Main Config Integration (`fileflow.toml`)

Introduce a new section:

```toml
[projects]
root = "%USERPROFILE%\\Projects"
blueprints = "project-blueprints.json"
```

- `projects.root`: required for `create` flow; env vars are expanded.
- `projects.blueprints`: optional; if omitted, default discovery is used.

### Blueprint Config and Standardization

Use two files:

- `project-blueprints.json` (runtime declarations)
- `project-blueprints.schema.json` (validation contract)

Blueprint model:

- `blueprints[]`: project type definitions
- each blueprint has `steps[]` (questions) and `actions[]` (operations)
- `condition` enables branching based on previous answers

Supported step types:

- `select`
- `confirm`
- `text`

Supported action types:

- `mkdir`
- `git_init`
- `git_clone`
- `shell`

Variable interpolation:

- Step answers can be referenced with `{{step_id}}` inside action fields.

### Config-First + Interactive Fallback

Resolution order:

1. Try blueprint file path from `projects.blueprints`.
2. If missing, try default local path (`project-blueprints.json`).
3. If still missing/invalid, run built-in fallback prompt flow.

Fallback flow:

- ask free-form project type name
- ask git strategy (`init`, `clone`, `none`)
- if `clone`, ask repository URL
- run actions accordingly

### Shell Safety

For `shell` actions:

- whitelist allowed commands in MVP (`git`, `bun`, `npm`, `node`, `pnpm`, `yarn`)
- allow extension through config (`allowedCommands`)
- prompt confirmation before execution by default
- allow non-interactive mode with `--yes`

### Error Handling

- Target folder already exists -> fail with clear message.
- Missing `projects.root` -> fail with config guidance.
- Invalid JSON/schema -> show validation summary, then fallback flow.
- Missing git binary for git action -> actionable error message.
- Failed clone/download/command -> stop flow, print failed step and command.

### Testing Strategy

Unit tests should cover:

- parsing/validation of `projects` config section
- blueprint loading and schema validation behavior
- condition evaluation and interpolation
- action execution semantics (`mkdir`, `git_init`, `git_clone`, `shell`)
- fallback flow when blueprint file is missing/invalid

Integration tests should cover:

- `fileflow create <name>` happy path with config blueprint
- clone and init decision branches
- existing target directory failure

## Module and File Plan

- `src/index.ts`: add `create` command handling and help output.
- `src/config.ts`: extend config model with `[projects]` section.
- `src/config.test.ts`: add validation tests for new config fields.
- `src/creator.ts`: core project creation flow and orchestration.
- `src/creator.test.ts`: decision engine and action tests.
- `src/blueprints.ts`: load/validate blueprint JSON.
- `src/blueprints.test.ts`: schema and fallback behavior tests.
- `project-blueprints.schema.json`: standardized schema.
- `docs/project-creator.md`: user-facing customization documentation.

## Example User Flow

```text
$ fileflow create my-app

FileFlow Project Creator

? Proje turu: Yazilim Projesi
? Git stratejisi: Yeni bos repo olustur

Created: C:\Users\you\Projects\my-app
Initialized git repository.

Next:
  cd C:\Users\you\Projects\my-app
```

## Future Extensions

- Save interactive choices back to blueprint profiles.
- Import/export blueprint packs.
- Optional template bootstrap for selected ecosystems.
