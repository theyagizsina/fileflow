import { describe, test, expect } from "bun:test";
import { join } from "path";
import { runCreateFlow, interpolate } from "./creator";
import type { PromptAdapter, FsAdapter, ExecAdapter } from "./creator";
import type { BlueprintsConfig } from "./blueprints";

// Helper to create mock adapters
function mockPrompt(answers: Record<string, unknown>): PromptAdapter {
  return {
    select: async (prompt, options) => answers[prompt] as string ?? options[0]!.value,
    text: async (prompt, def) => answers[prompt] as string ?? def ?? "",
    confirm: async (prompt, def) => answers[prompt] as boolean ?? def ?? true,
  };
}

function mockFs(existingPaths: string[] = []): FsAdapter & { created: string[] } {
  const created: string[] = [];
  const normalized = existingPaths.map((p) => join(p));
  return {
    exists: (p) => normalized.includes(join(p)),
    mkdir: (p) => { created.push(p); },
    created,
  };
}

function mockExec(): ExecAdapter & { calls: { command: string; args: string[]; cwd: string }[] } {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  return {
    run: async (cmd, args, cwd) => { calls.push({ command: cmd, args, cwd }); return { exitCode: 0, output: "" }; },
    calls,
  };
}

describe("interpolate", () => {
  test("replaces {{key}} with answers", () => {
    expect(interpolate("clone {{url}} .", { url: "https://github.com/x/y" }))
      .toBe("clone https://github.com/x/y .");
  });

  test("replaces missing keys with empty string", () => {
    expect(interpolate("{{missing}}", {})).toBe("");
  });

  test("leaves non-template strings unchanged", () => {
    expect(interpolate("hello world", {})).toBe("hello world");
  });
});

describe("runCreateFlow", () => {
  const sampleBlueprints: BlueprintsConfig = {
    blueprints: [{
      id: "software",
      name: "Software Project",
      steps: [
        {
          id: "git_strategy",
          prompt: "Git strategy?",
          type: "select",
          options: [
            { value: "init", label: "New repo" },
            { value: "clone", label: "Clone repo" },
            { value: "none", label: "No git" },
          ],
          default: "init",
        },
        {
          id: "repo_url",
          prompt: "Repo URL?",
          type: "text",
          condition: { step: "git_strategy", equals: "clone" },
        },
      ],
      actions: [
        { type: "mkdir" },
        { type: "git_init", condition: { step: "git_strategy", equals: "init" } },
        { type: "git_clone", url: "{{repo_url}}", condition: { step: "git_strategy", equals: "clone" } },
      ],
    }],
  };

  test("creates directory and runs git init for init strategy", async () => {
    const prompt = mockPrompt({
      // blueprint selection (when multiple, picks by prompt text)
    });
    // Override select to return specific values
    let selectCallCount = 0;
    prompt.select = async () => {
      selectCallCount++;
      if (selectCallCount === 1) return "software"; // blueprint selection
      return "init"; // git strategy
    };
    const fs = mockFs();
    const exec = mockExec();

    const result = await runCreateFlow({
      projectName: "my-app",
      projectsRoot: "/projects",
      blueprints: sampleBlueprints,
      prompt, fs, exec,
    });

    expect(result.projectPath).toContain("my-app");
    expect(fs.created).toContain(result.projectPath);
    expect(exec.calls.some(c => c.command === "git" && c.args[0] === "init")).toBe(true);
    expect(exec.calls.some(c => c.args[0] === "clone")).toBe(false);
  });

  test("runs git clone with interpolated repo_url", async () => {
    let selectCallCount = 0;
    const prompt = mockPrompt({});
    prompt.select = async () => {
      selectCallCount++;
      if (selectCallCount === 1) return "software";
      return "clone";
    };
    prompt.text = async () => "https://github.com/user/repo.git";
    const fs = mockFs();
    const exec = mockExec();

    const result = await runCreateFlow({
      projectName: "my-fork",
      projectsRoot: "/projects",
      blueprints: sampleBlueprints,
      prompt, fs, exec,
    });

    const cloneCall = exec.calls.find(c => c.args[0] === "clone");
    expect(cloneCall).toBeDefined();
    expect(cloneCall!.args[1]).toBe("https://github.com/user/repo.git");
  });

  test("uses fallback flow when no blueprints provided", async () => {
    const prompt = mockPrompt({});
    prompt.text = async () => "my-type";
    prompt.select = async () => "init";
    const fs = mockFs();
    const exec = mockExec();

    const result = await runCreateFlow({
      projectName: "test-proj",
      projectsRoot: "/projects",
      prompt, fs, exec,
    });

    expect(result.blueprintName).toBe("Custom Project");
    expect(fs.created.length).toBeGreaterThan(0);
  });

  test("skips conditional steps when condition is unmet", async () => {
    let selectCallCount = 0;
    const prompt = mockPrompt({});
    let textCalled = false;
    prompt.select = async () => {
      selectCallCount++;
      if (selectCallCount === 1) return "software";
      return "init"; // not "clone", so repo_url should be skipped
    };
    prompt.text = async () => { textCalled = true; return ""; };
    const fs = mockFs();
    const exec = mockExec();

    await runCreateFlow({
      projectName: "no-clone",
      projectsRoot: "/projects",
      blueprints: sampleBlueprints,
      prompt, fs, exec,
    });

    expect(textCalled).toBe(false); // repo_url prompt should never have been called
  });

  test("throws when target directory already exists", async () => {
    const prompt = mockPrompt({});
    const fs = mockFs(["/projects/existing"]);
    const exec = mockExec();

    await expect(
      runCreateFlow({
        projectName: "existing",
        projectsRoot: "/projects",
        prompt, fs, exec,
      })
    ).rejects.toThrow("already exists");
  });

  test("throws for disallowed shell command", async () => {
    const shellBlueprint: BlueprintsConfig = {
      blueprints: [{
        id: "custom",
        name: "Custom",
        steps: [],
        actions: [
          { type: "mkdir" },
          { type: "shell", command: "rm", args: ["-rf", "/"] },
        ],
      }],
    };
    const prompt = mockPrompt({});
    prompt.select = async () => "custom";
    const fs = mockFs();
    const exec = mockExec();

    await expect(
      runCreateFlow({
        projectName: "danger",
        projectsRoot: "/projects",
        blueprints: shellBlueprint,
        prompt, fs, exec,
      })
    ).rejects.toThrow("not allowed");
  });

  test("shell action asks confirmation unless --yes", async () => {
    const shellBlueprint: BlueprintsConfig = {
      blueprints: [{
        id: "withshell",
        name: "With Shell",
        steps: [],
        actions: [
          { type: "mkdir" },
          { type: "shell", command: "bun", args: ["init"] },
        ],
      }],
    };
    let confirmCalled = false;
    const prompt = mockPrompt({});
    prompt.select = async () => "withshell";
    prompt.confirm = async () => { confirmCalled = true; return true; };
    const fs = mockFs();
    const exec = mockExec();

    await runCreateFlow({
      projectName: "shell-test",
      projectsRoot: "/projects",
      blueprints: shellBlueprint,
      prompt, fs, exec,
    });

    expect(confirmCalled).toBe(true);
    expect(exec.calls.some(c => c.command === "bun")).toBe(true);
  });

  test("shell action skips confirmation with --yes", async () => {
    const shellBlueprint: BlueprintsConfig = {
      blueprints: [{
        id: "withshell",
        name: "With Shell",
        steps: [],
        actions: [
          { type: "mkdir" },
          { type: "shell", command: "bun", args: ["init"] },
        ],
      }],
    };
    let confirmCalled = false;
    const prompt = mockPrompt({});
    prompt.select = async () => "withshell";
    prompt.confirm = async () => { confirmCalled = true; return true; };
    const fs = mockFs();
    const exec = mockExec();

    await runCreateFlow({
      projectName: "shell-yes",
      projectsRoot: "/projects",
      blueprints: shellBlueprint,
      yes: true,
      prompt, fs, exec,
    });

    expect(confirmCalled).toBe(false);
    expect(exec.calls.some(c => c.command === "bun")).toBe(true);
  });

  test("action failure propagates to summary success=false", async () => {
    const shellBlueprint: BlueprintsConfig = {
      blueprints: [{
        id: "failing",
        name: "Failing",
        steps: [],
        actions: [
          { type: "mkdir" },
          { type: "shell", command: "bun", args: ["build"] },
        ],
      }],
    };
    const prompt = mockPrompt({});
    prompt.select = async () => "failing";
    const fs = mockFs();
    const exec = mockExec();
    // Override run to return failure for bun
    exec.run = async (cmd, args, cwd) => {
      exec.calls.push({ command: cmd, args, cwd });
      if (cmd === "bun") return { exitCode: 1, output: "error: build failed" };
      return { exitCode: 0, output: "" };
    };

    const result = await runCreateFlow({
      projectName: "fail-proj",
      projectsRoot: "/projects",
      blueprints: shellBlueprint,
      yes: true,
      prompt, fs, exec,
    });

    expect(result.success).toBe(false);
    const failedAction = result.actions.find(a => !a.success);
    expect(failedAction).toBeDefined();
    expect(failedAction!.action).toContain("failed");
    expect(failedAction!.action).toContain("error: build failed");
  });

  test("shell action with missing command returns failure", async () => {
    const shellBlueprint: BlueprintsConfig = {
      blueprints: [{
        id: "nocommand",
        name: "No Command",
        steps: [],
        actions: [
          { type: "mkdir" },
          { type: "shell" as const, args: ["something"] },
        ],
      }],
    };
    const prompt = mockPrompt({});
    prompt.select = async () => "nocommand";
    const fs = mockFs();
    const exec = mockExec();

    const result = await runCreateFlow({
      projectName: "nocmd-proj",
      projectsRoot: "/projects",
      blueprints: shellBlueprint,
      yes: true,
      prompt, fs, exec,
    });

    expect(result.success).toBe(false);
    const failedAction = result.actions.find(a => !a.success);
    expect(failedAction).toBeDefined();
    expect(failedAction!.action).toBe("shell: missing command");
  });

  test("git_init creates directory if not already created", async () => {
    // Blueprint with only git_init (no mkdir action)
    const initOnlyBlueprint: BlueprintsConfig = {
      blueprints: [{
        id: "initonly",
        name: "Init Only",
        steps: [],
        actions: [
          { type: "git_init" },
        ],
      }],
    };
    const prompt = mockPrompt({});
    prompt.select = async () => "initonly";
    const fs = mockFs();
    const exec = mockExec();

    const result = await runCreateFlow({
      projectName: "init-dir",
      projectsRoot: "/projects",
      blueprints: initOnlyBlueprint,
      prompt, fs, exec,
    });

    expect(fs.created).toContain(result.projectPath);
    expect(result.success).toBe(true);
    expect(exec.calls.some(c => c.command === "git" && c.args[0] === "init")).toBe(true);
  });

  test("all actions succeeding yields summary success=true", async () => {
    let selectCallCount = 0;
    const prompt = mockPrompt({});
    prompt.select = async () => {
      selectCallCount++;
      if (selectCallCount === 1) return "software";
      return "init";
    };
    const fs = mockFs();
    const exec = mockExec();

    const result = await runCreateFlow({
      projectName: "success-proj",
      projectsRoot: "/projects",
      blueprints: sampleBlueprints,
      prompt, fs, exec,
    });

    expect(result.success).toBe(true);
    expect(result.actions.every(a => a.success)).toBe(true);
  });
});
