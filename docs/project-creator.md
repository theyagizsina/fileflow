# Project Creator

## Overview

The `fileflow create` command creates new projects under a configurable root directory. It supports two modes of operation:

- **Blueprint-driven** -- uses a JSON configuration file to define project types with interactive prompts and automated setup actions.
- **Fallback** -- when no blueprint file is configured or the file contains errors, a built-in interactive flow runs instead.

The command resolves the target path as `{projects.root}/{project-name}`, walks through any defined steps, then executes actions like creating directories, initializing git, cloning repositories, or running shell commands.

## Configuration

Add a `[projects]` section to your `fileflow.toml`:

```toml
[projects]
root = "%USERPROFILE%\\Projects"
blueprints = "project-blueprints.json"
allowed_commands = ["git", "bun", "npm", "node", "pnpm", "yarn", "cargo"]
```

### Fields

| Field              | Required | Description                                                                                         |
|--------------------|----------|-----------------------------------------------------------------------------------------------------|
| `root`             | Yes      | Absolute path to the directory where projects are created. Supports `%ENV_VAR%` expansion.          |
| `blueprints`       | No       | Path to a JSON blueprint configuration file. If omitted, the fallback flow is used.                 |
| `allowed_commands` | No       | Whitelist of shell commands permitted in blueprint `shell` actions. Defaults to `git`, `bun`, `npm`, `node`, `pnpm`, `yarn`. |

## Quick Start

1. Add the minimal configuration to `fileflow.toml`:

```toml
[projects]
root = "%USERPROFILE%\\Projects"
```

2. Run the create command:

```
fileflow create my-app
```

Without a blueprints file, the fallback flow prompts you for a project type name, git strategy (init, clone, or none), and a repository URL if cloning.

## Blueprint Configuration

Blueprints are defined in a JSON file referenced by `projects.blueprints`. The file must conform to the schema defined in `project-blueprints.schema.json`.

### Structure

The top-level object contains a `blueprints` array. Each blueprint defines a project type with interactive steps and post-step actions:

```json
{
  "$schema": "./project-blueprints.schema.json",
  "blueprints": [
    {
      "id": "web-app",
      "name": "Web Application",
      "description": "Optional description",
      "steps": [],
      "actions": []
    }
  ]
}
```

### Blueprint fields

| Field         | Required | Description                                          |
|---------------|----------|------------------------------------------------------|
| `id`          | Yes      | Unique identifier for the blueprint.                 |
| `name`        | Yes      | Display name shown in the selection menu.            |
| `description` | No       | Optional description of the blueprint.               |
| `steps`       | Yes      | Array of interactive prompt steps.                   |
| `actions`     | Yes      | Array of actions executed after steps are completed. |

### Steps

Each step collects input from the user. Steps are executed in order.

| Field       | Required | Description                                                        |
|-------------|----------|--------------------------------------------------------------------|
| `id`        | Yes      | Unique identifier. Used to reference the answer in conditions and templates. |
| `prompt`    | Yes      | The question displayed to the user.                                |
| `type`      | Yes      | One of `select`, `confirm`, or `text`.                             |
| `options`   | Conditional | Required when `type` is `select`. Array of `{ value, label }` objects. |
| `default`   | No       | Default value. String for `text`/`select`, boolean for `confirm`.  |
| `condition` | No       | If present, the step is only shown when the condition is met.      |

#### Step types

- **`select`** -- presents a list of options. Requires an `options` array.
- **`confirm`** -- yes/no prompt. Returns a boolean.
- **`text`** -- free-form text input.

#### Conditional steps

A step can be shown conditionally based on a previous step's answer:

```json
{
  "id": "repo_url",
  "prompt": "Repository URL:",
  "type": "text",
  "condition": { "step": "git_strategy", "equals": "clone" }
}
```

The `condition` object requires:
- `step` -- the `id` of a previous step.
- `equals` -- the value (string or boolean) to compare against.

### Actions

Actions run sequentially after all steps are complete. Each action can also have a `condition` to control whether it executes.

| Field       | Required | Description                                              |
|-------------|----------|----------------------------------------------------------|
| `type`      | Yes      | One of `mkdir`, `git_init`, `git_clone`, or `shell`.     |
| `condition` | No       | Same format as step conditions.                          |
| `url`       | No       | Repository URL for `git_clone`. Supports template syntax.|
| `command`   | No       | Command name for `shell` actions.                        |
| `args`      | No       | Array of arguments for `shell` actions.                  |

#### Action types

- **`mkdir`** -- creates the project directory.
- **`git_init`** -- runs `git init` in the project directory. Creates the directory first if it does not exist.
- **`git_clone`** -- runs `git clone <url> .` in the project directory. The `url` field supports template syntax. Creates the directory first if it does not exist.
- **`shell`** -- executes a shell command. The `command` must be in the allowed commands whitelist. `args` supports template syntax.

#### Template syntax

Action fields (`url`, `args`) support `{{step_id}}` interpolation. At execution time, each `{{step_id}}` placeholder is replaced with the corresponding step's answer:

```json
{
  "type": "git_clone",
  "url": "{{repo_url}}",
  "condition": { "step": "git_strategy", "equals": "clone" }
}
```

```json
{
  "type": "shell",
  "command": "bun",
  "args": ["create", "{{framework}}", "."]
}
```

### Schema validation

Point your editor or tooling at the JSON Schema for autocompletion and validation:

```json
{
  "$schema": "./project-blueprints.schema.json"
}
```

The schema is defined in `project-blueprints.schema.json` at the repository root.

## Fallback Flow

When no blueprint file is configured, the file does not exist, or the file contains validation errors, the create command falls back to a built-in interactive flow:

1. **Project type name** -- free-form text input (default: "general").
2. **Git strategy** -- select from: initialize new repository, clone existing repository, or no git.
3. **Repository URL** -- prompted only when clone is selected.

Actions are then executed based on the answers: the project directory is created, and git is initialized or cloned as requested.

If a blueprint file has errors, the validation errors are printed before falling back.

## Shell Action Safety

Shell actions (`type: "shell"`) are restricted for safety:

- The `command` field is checked against the allowed commands whitelist. If the command is not in the list, execution is rejected with an error.
- The default whitelist is: `git`, `bun`, `npm`, `node`, `pnpm`, `yarn`.
- Extend the whitelist via `allowed_commands` in `fileflow.toml`.
- Before executing a shell action, the user is prompted for confirmation showing the full command and arguments.
- Pass `--yes` to skip confirmation prompts and auto-approve all shell actions.

## CLI Usage

```
fileflow create <name> [--config <path>] [--yes]
```

| Argument / Flag    | Description                                                        |
|--------------------|--------------------------------------------------------------------|
| `<name>`           | Required. The project directory name, created under `projects.root`. |
| `--config <path>`  | Path to `fileflow.toml`. Defaults to `%APPDATA%\FileFlow\fileflow.toml`, then the current directory. |
| `--yes`, `-y`      | Auto-confirm shell action prompts without asking.                  |

### Examples

```bash
# Create a project using default config location
fileflow create my-app

# Create a project with a specific config
fileflow create my-app --config ./fileflow.toml

# Create a project and auto-confirm all shell actions
fileflow create my-app --yes
```

## Example Blueprint

A complete `project-blueprints.json` demonstrating a web application blueprint with framework selection, conditional cloning, and dependency installation:

```json
{
  "$schema": "./project-blueprints.schema.json",
  "blueprints": [
    {
      "id": "web-app",
      "name": "Web Application",
      "description": "Scaffold a web application project",
      "steps": [
        {
          "id": "framework",
          "prompt": "Select a framework:",
          "type": "select",
          "options": [
            { "value": "react", "label": "React" },
            { "value": "vue", "label": "Vue" },
            { "value": "svelte", "label": "Svelte" }
          ]
        },
        {
          "id": "git_strategy",
          "prompt": "Git strategy:",
          "type": "select",
          "options": [
            { "value": "init", "label": "Initialize new repository" },
            { "value": "clone", "label": "Clone existing repository" },
            { "value": "none", "label": "No git" }
          ],
          "default": "init"
        },
        {
          "id": "repo_url",
          "prompt": "Repository URL:",
          "type": "text",
          "condition": { "step": "git_strategy", "equals": "clone" }
        },
        {
          "id": "install_deps",
          "prompt": "Install dependencies?",
          "type": "confirm",
          "default": true
        }
      ],
      "actions": [
        {
          "type": "mkdir"
        },
        {
          "type": "git_init",
          "condition": { "step": "git_strategy", "equals": "init" }
        },
        {
          "type": "git_clone",
          "url": "{{repo_url}}",
          "condition": { "step": "git_strategy", "equals": "clone" }
        },
        {
          "type": "shell",
          "command": "bun",
          "args": ["create", "{{framework}}", "."],
          "condition": { "step": "git_strategy", "equals": "init" }
        },
        {
          "type": "shell",
          "command": "npm",
          "args": ["install"],
          "condition": { "step": "install_deps", "equals": true }
        }
      ]
    }
  ]
}
```

With this blueprint and the following config:

```toml
[projects]
root = "%USERPROFILE%\\Projects"
blueprints = "project-blueprints.json"
```

Running `fileflow create my-app` will:

1. Prompt you to select the "Web Application" blueprint.
2. Ask which framework to use.
3. Ask for a git strategy.
4. If clone was selected, ask for the repository URL.
5. Ask whether to install dependencies.
6. Execute actions in order: create the directory, set up git, scaffold the framework, and install dependencies.
