import { describe, test, expect } from "bun:test";
import { loadBlueprints } from "./blueprints";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const tmpDir = join(process.env.TEMP || "/tmp", "fileflow_test_blueprints");

function cleanup() {
  rmSync(tmpDir, { recursive: true, force: true });
}

function writeBlueprint(content: string): string {
  cleanup();
  mkdirSync(tmpDir, { recursive: true });
  const p = join(tmpDir, "bp.json");
  writeFileSync(p, content);
  return p;
}

describe("loadBlueprints", () => {
  test("loads valid blueprint with all fields", () => {
    const path = writeBlueprint(JSON.stringify({
      blueprints: [{
        id: "software",
        name: "Software Project",
        steps: [{
          id: "git_strategy",
          prompt: "Git strategy?",
          type: "select",
          options: [{ value: "init", label: "Init" }],
          default: "init"
        }],
        actions: [{ type: "mkdir" }, { type: "git_init", condition: { step: "git_strategy", equals: "init" } }]
      }]
    }));
    const result = loadBlueprints(path);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blueprints).toHaveLength(1);
      expect(result.value.blueprints[0]!.id).toBe("software");
    }
    cleanup();
  });

  test("returns error for malformed JSON", () => {
    const path = writeBlueprint("not json {{{");
    const result = loadBlueprints(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Invalid JSON");
    }
    cleanup();
  });

  test("returns error when blueprints array is missing", () => {
    const path = writeBlueprint(JSON.stringify({}));
    const result = loadBlueprints(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e: string) => e.includes("blueprints"))).toBe(true);
    }
    cleanup();
  });

  test("returns error when blueprint missing id", () => {
    const path = writeBlueprint(JSON.stringify({
      blueprints: [{ name: "Test", steps: [], actions: [] }]
    }));
    const result = loadBlueprints(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e: string) => e.includes("id"))).toBe(true);
    }
    cleanup();
  });

  test("returns error when step has invalid type", () => {
    const path = writeBlueprint(JSON.stringify({
      blueprints: [{
        id: "test", name: "Test",
        steps: [{ id: "s1", prompt: "?", type: "dropdown" }],
        actions: []
      }]
    }));
    const result = loadBlueprints(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e: string) => e.includes("type"))).toBe(true);
    }
    cleanup();
  });

  test("returns error when select step has no options", () => {
    const path = writeBlueprint(JSON.stringify({
      blueprints: [{
        id: "test", name: "Test",
        steps: [{ id: "s1", prompt: "?", type: "select" }],
        actions: []
      }]
    }));
    const result = loadBlueprints(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e: string) => e.includes("options"))).toBe(true);
    }
    cleanup();
  });

  test("returns error when action has invalid type", () => {
    const path = writeBlueprint(JSON.stringify({
      blueprints: [{
        id: "test", name: "Test",
        steps: [],
        actions: [{ type: "deploy" }]
      }]
    }));
    const result = loadBlueprints(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e: string) => e.includes("type"))).toBe(true);
    }
    cleanup();
  });

  test("collects multiple errors from different blueprints", () => {
    const path = writeBlueprint(JSON.stringify({
      blueprints: [
        { name: "No ID", steps: [], actions: [] },
        { id: "ok", steps: [{ id: "s", prompt: "?", type: "bad" }], actions: [] }
      ]
    }));
    const result = loadBlueprints(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
    cleanup();
  });

  test("uses injected readFileFn", () => {
    const content = JSON.stringify({
      blueprints: [{
        id: "test", name: "Test",
        steps: [],
        actions: [{ type: "mkdir" }]
      }]
    });
    const fakeRead = (_p: string, _enc: string) => content;
    const result = loadBlueprints("fake-path.json", fakeRead);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.blueprints[0]!.id).toBe("test");
    }
  });
});
