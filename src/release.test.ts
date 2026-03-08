import { describe, expect, test } from "bun:test";
import { buildReleaseAssetUrl, normalizeVersionTag } from "./release";

describe("normalizeVersionTag", () => {
  test("keeps tags already starting with v", () => {
    expect(normalizeVersionTag("v0.1.0-alpha.1")).toBe("v0.1.0-alpha.1");
  });

  test("adds v prefix when omitted", () => {
    expect(normalizeVersionTag("0.1.0-alpha.1")).toBe("v0.1.0-alpha.1");
  });

  test("rejects empty version", () => {
    expect(() => normalizeVersionTag("   ")).toThrow("Version is required");
  });
});

describe("buildReleaseAssetUrl", () => {
  test("builds GitHub release asset URL", () => {
    const url = buildReleaseAssetUrl({
      owner: "theyagizsina",
      repo: "fileflow",
      version: "v0.1.0-alpha.1",
      assetName: "fileflow.exe",
    });

    expect(url).toBe(
      "https://github.com/theyagizsina/fileflow/releases/download/v0.1.0-alpha.1/fileflow.exe"
    );
  });

  test("normalizes version with missing v prefix", () => {
    const url = buildReleaseAssetUrl({
      owner: "theyagizsina",
      repo: "fileflow",
      version: "0.1.0-alpha.1",
      assetName: "fileflow.exe",
    });

    expect(url).toContain("/download/v0.1.0-alpha.1/");
  });
});
