import { describe, test, expect } from "bun:test";
import { formatLogLine } from "./logger";

describe("formatLogLine", () => {
  test("formats log line with timestamp", () => {
    const line = formatLogLine("info", "MOVED file.txt -> W:\\Media");
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] INFO MOVED file\.txt -> W:\\Media$/);
  });

  test("formats warn level", () => {
    const line = formatLogLine("warn", "SKIPPED file.tmp");
    expect(line).toContain("WARN");
  });
});
