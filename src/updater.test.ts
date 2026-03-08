import { describe, test, expect } from "bun:test";
import { checkForUpdate, performUpdate, cleanupOldBinary } from "./updater";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

describe("checkForUpdate", () => {
  test("returns latest version when newer release exists", async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.2.0",
        assets: [{ name: "fileflow.exe", browser_download_url: "https://example.com/fileflow.exe" }],
      }),
    });

    const result = await checkForUpdate({
      currentVersion: "0.1.0",
      fetchFn: fakeFetch as any,
      repoOwner: "theyagizsina",
      repoName: "fileflow",
    });

    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe("0.2.0");
    expect(result.downloadUrl).toBe("https://example.com/fileflow.exe");
  });

  test("returns not available when already up to date", async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.1.0",
        assets: [{ name: "fileflow.exe", browser_download_url: "https://example.com/fileflow.exe" }],
      }),
    });

    const result = await checkForUpdate({
      currentVersion: "0.1.0",
      fetchFn: fakeFetch as any,
      repoOwner: "theyagizsina",
      repoName: "fileflow",
    });

    expect(result.available).toBe(false);
    expect(result.latestVersion).toBe("0.1.0");
  });

  test("throws when fetch fails", async () => {
    const fakeFetch = async () => ({ ok: false, status: 404 });

    expect(
      checkForUpdate({
        currentVersion: "0.1.0",
        fetchFn: fakeFetch as any,
        repoOwner: "theyagizsina",
        repoName: "fileflow",
      })
    ).rejects.toThrow("Failed to check for updates");
  });

  test("throws when no exe asset found in release", async () => {
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({
        tag_name: "v0.2.0",
        assets: [{ name: "readme.txt", browser_download_url: "https://example.com/readme.txt" }],
      }),
    });

    expect(
      checkForUpdate({
        currentVersion: "0.1.0",
        fetchFn: fakeFetch as any,
        repoOwner: "theyagizsina",
        repoName: "fileflow",
      })
    ).rejects.toThrow("fileflow.exe not found in release assets");
  });
});

describe("performUpdate", () => {
  const tmpDir = join(process.env.TEMP || "/tmp", "fileflow_test_update");

  function cleanup() {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  function setupExe(): string {
    cleanup();
    mkdirSync(tmpDir, { recursive: true });
    const exePath = join(tmpDir, "fileflow.exe");
    writeFileSync(exePath, "old-binary-content");
    return exePath;
  }

  test("downloads and replaces binary via rename-aside", async () => {
    const exePath = setupExe();
    const newContent = "new-binary-content";

    const fakeFetch = async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(newContent).buffer,
    });

    const result = await performUpdate({
      exePath,
      downloadUrl: "https://example.com/fileflow.exe",
      fetchFn: fakeFetch as any,
    });

    expect(result.success).toBe(true);
    expect(readFileSync(exePath, "utf-8")).toBe(newContent);
    expect(existsSync(exePath + ".old")).toBe(true);
    expect(readFileSync(exePath + ".old", "utf-8")).toBe("old-binary-content");
    cleanup();
  });

  test("cleans up .new file on download failure", async () => {
    const exePath = setupExe();

    const fakeFetch = async () => ({ ok: false, status: 500 });

    expect(
      performUpdate({
        exePath,
        downloadUrl: "https://example.com/fileflow.exe",
        fetchFn: fakeFetch as any,
      })
    ).rejects.toThrow("Failed to download update");

    expect(existsSync(exePath + ".new")).toBe(false);
    expect(readFileSync(exePath, "utf-8")).toBe("old-binary-content");
    cleanup();
  });
});

describe("cleanupOldBinary", () => {
  const tmpDir = join(process.env.TEMP || "/tmp", "fileflow_test_cleanup");

  function cleanup() {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  test("deletes .old file when it exists", () => {
    cleanup();
    mkdirSync(tmpDir, { recursive: true });
    const exePath = join(tmpDir, "fileflow.exe");
    const oldPath = exePath + ".old";
    writeFileSync(oldPath, "stale");

    cleanupOldBinary(exePath);

    expect(existsSync(oldPath)).toBe(false);
    cleanup();
  });

  test("does nothing when .old file does not exist", () => {
    cleanup();
    mkdirSync(tmpDir, { recursive: true });
    const exePath = join(tmpDir, "fileflow.exe");

    // Should not throw
    cleanupOldBinary(exePath);
    cleanup();
  });
});
