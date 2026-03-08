import { describe, test, expect } from "bun:test";
import { runValidation, type ValidateDeps } from "./validate";

function makeDeps(overrides: Partial<ValidateDeps> = {}): ValidateDeps {
  return {
    configPath: "C:\\test\\fileflow.toml",
    watchPaths: ["C:\\Users\\test\\Downloads"],
    rules: [
      { name: "Docs", type: "extension", match: [".pdf", ".docx"], destination: "C:\\Sorted\\Docs" },
    ],
    pathExists: () => true,
    isWritable: () => true,
    ...overrides,
  };
}

describe("runValidation", () => {
  test("all checks pass — returns OK result with no errors", () => {
    const result = runValidation(makeDeps());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("watch path does not exist — returns error", () => {
    const result = runValidation(
      makeDeps({
        watchPaths: ["C:\\missing\\path"],
        pathExists: (p: string) => p !== "C:\\missing\\path",
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes("C:\\missing\\path") && e.includes("does not exist"))).toBe(true);
  });

  test("multiple watch paths — reports each missing one", () => {
    const existing = new Set(["C:\\exists", "C:\\Sorted\\Docs"]);
    const result = runValidation(
      makeDeps({
        watchPaths: ["C:\\exists", "C:\\missing1", "C:\\missing2"],
        pathExists: (p: string) => existing.has(p),
        isWritable: () => true,
      })
    );
    expect(result.errors.filter((e: string) => e.includes("does not exist"))).toHaveLength(2);
  });

  test("rule destination does not exist — returns error", () => {
    const result = runValidation(
      makeDeps({
        rules: [{ name: "Docs", type: "extension", match: [".pdf"], destination: "C:\\nowhere" }],
        pathExists: (p: string) => p !== "C:\\nowhere",
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes("Docs") && e.includes("C:\\nowhere"))).toBe(true);
  });

  test("rule destination exists but not writable — returns error", () => {
    const result = runValidation(
      makeDeps({
        rules: [{ name: "Docs", type: "extension", match: [".pdf"], destination: "C:\\readonly" }],
        pathExists: () => true,
        isWritable: (p: string) => p !== "C:\\readonly",
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes("Docs") && e.includes("not writable"))).toBe(true);
  });

  test("extension rule match without leading dot — returns warning", () => {
    const result = runValidation(
      makeDeps({
        rules: [{ name: "Pics", type: "extension", match: ["jpg", ".png"], destination: "C:\\Sorted\\Pics" }],
      })
    );
    expect(result.warnings.some((w: string) => w.includes("Pics") && w.includes("jpg") && w.includes("dot"))).toBe(true);
  });

  test("pattern rule match without dot is fine — no warning", () => {
    const result = runValidation(
      makeDeps({
        rules: [{ name: "Screens", type: "pattern", match: ["Screenshot*"], destination: "C:\\Sorted\\Screens" }],
      })
    );
    expect(result.warnings).toHaveLength(0);
  });

  test("formatReport produces human-readable output with pass/fail", () => {
    const result = runValidation(makeDeps());
    expect(result.report).toContain("PASS");
    expect(result.report).toContain("Config");
  });

  test("formatReport shows errors when validation fails", () => {
    const result = runValidation(
      makeDeps({
        watchPaths: ["C:\\missing"],
        pathExists: () => false,
        isWritable: () => false,
      })
    );
    expect(result.report).toContain("FAIL");
    expect(result.report).toContain("C:\\missing");
  });

  test("formatReport shows warnings alongside passes", () => {
    const result = runValidation(
      makeDeps({
        rules: [{ name: "Pics", type: "extension", match: ["jpg"], destination: "C:\\Sorted\\Pics" }],
      })
    );
    expect(result.report).toContain("WARN");
    expect(result.report).toContain("jpg");
  });

  test("duplicate rule names — returns warning", () => {
    const result = runValidation(
      makeDeps({
        rules: [
          { name: "Docs", type: "extension", match: [".pdf"], destination: "C:\\Sorted\\Docs" },
          { name: "Docs", type: "extension", match: [".docx"], destination: "C:\\Sorted\\Docs2" },
        ],
      })
    );
    expect(result.warnings.some((w: string) => w.includes("Docs") && w.includes("duplicate"))).toBe(true);
  });
});
