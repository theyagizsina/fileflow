import { describe, test, expect } from "bun:test";
import { explainFile, type ExplainDeps } from "./explain";
import type { Rule } from "./config";

function makeDeps(overrides: Partial<ExplainDeps> = {}): ExplainDeps {
  return {
    filePath: "C:\\Users\\test\\Downloads\\report.pdf",
    rules: [
      { name: "Docs", type: "extension", match: [".pdf", ".docx"], destination: "C:\\Sorted\\Docs" },
      { name: "Videos", type: "extension", match: [".mp4", ".mkv"], destination: "C:\\Sorted\\Videos" },
    ],
    ignoreExtensions: [".tmp", ".crdownload"],
    ...overrides,
  };
}

describe("explainFile", () => {
  test("shows matching rule when file matches extension rule", () => {
    const result = explainFile(makeDeps());
    expect(result.matched).toBe(true);
    expect(result.ruleName).toBe("Docs");
    expect(result.destination).toBe("C:\\Sorted\\Docs");
    expect(result.report).toContain("report.pdf");
    expect(result.report).toContain("Docs");
  });

  test("shows matching rule for pattern type", () => {
    const result = explainFile(
      makeDeps({
        filePath: "Screenshot_2026.png",
        rules: [
          { name: "Screenshots", type: "pattern", match: ["Screenshot*"], destination: "C:\\Sorted\\Screenshots" },
        ],
      })
    );
    expect(result.matched).toBe(true);
    expect(result.ruleName).toBe("Screenshots");
    expect(result.report).toContain("Screenshots");
    expect(result.report).toContain("pattern");
  });

  test("first matching rule wins when multiple rules match", () => {
    const result = explainFile(
      makeDeps({
        filePath: "doc.pdf",
        rules: [
          { name: "AllPDFs", type: "extension", match: [".pdf"], destination: "C:\\PDFs" },
          { name: "Docs", type: "extension", match: [".pdf", ".docx"], destination: "C:\\Docs" },
        ],
      })
    );
    expect(result.ruleName).toBe("AllPDFs");
  });

  test("returns no match when no rule matches", () => {
    const result = explainFile(
      makeDeps({
        filePath: "C:\\Users\\test\\Downloads\\random.xyz",
      })
    );
    expect(result.matched).toBe(false);
    expect(result.ruleName).toBeUndefined();
    expect(result.report).toContain("No rule matched");
  });

  test("report lists all rules that were checked when no match", () => {
    const result = explainFile(
      makeDeps({
        filePath: "random.xyz",
      })
    );
    expect(result.report).toContain("Docs");
    expect(result.report).toContain("Videos");
  });

  test("skipped by temp extension — reports skip reason", () => {
    const result = explainFile(
      makeDeps({
        filePath: "download.crdownload",
      })
    );
    expect(result.skipped).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.report).toContain("ignored");
    expect(result.report).toContain(".crdownload");
  });

  test("shows which specific match value triggered the rule", () => {
    const result = explainFile(
      makeDeps({
        filePath: "thesis.docx",
      })
    );
    expect(result.matched).toBe(true);
    expect(result.matchedValue).toBe(".docx");
  });

  test("report includes file extension for extension-type rules", () => {
    const result = explainFile(
      makeDeps({
        filePath: "video.mp4",
      })
    );
    expect(result.report).toContain(".mp4");
    expect(result.report).toContain("Videos");
  });

  test("works with just a filename (no directory path)", () => {
    const result = explainFile(
      makeDeps({
        filePath: "report.pdf",
      })
    );
    expect(result.matched).toBe(true);
    expect(result.ruleName).toBe("Docs");
  });
});
