# --update Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `--update` flag that self-updates the FileFlow binary from the latest GitHub release.

**Architecture:** A new `src/updater.ts` module handles version checking (GitHub API) and binary replacement (rename-aside pattern). All external dependencies (HTTP fetch, filesystem ops) are injected for testability. The CLI entry point wires it together and handles `.old` file cleanup on startup.

**Tech Stack:** Bun (fetch API for HTTP), Node fs/path for file operations, `bun:test` for testing.

---

### Task 1: Create updater module with `checkForUpdate`

**Files:**
- Create: `src/updater.ts`
- Create: `src/updater.test.ts`

**Step 1: Write the failing test for `checkForUpdate`**

In `src/updater.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { checkForUpdate } from "./updater";

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
```

**Step 2: Run test to verify it fails**

Run: `bun test src/updater.test.ts`
Expected: FAIL — module `./updater` does not exist.

**Step 3: Implement `checkForUpdate`**

In `src/updater.ts`:

```typescript
export interface UpdateCheckResult {
  available: boolean;
  latestVersion: string;
  downloadUrl?: string;
}

export interface CheckForUpdateOptions {
  currentVersion: string;
  fetchFn: typeof fetch;
  repoOwner: string;
  repoName: string;
}

export async function checkForUpdate(opts: CheckForUpdateOptions): Promise<UpdateCheckResult> {
  const { currentVersion, fetchFn, repoOwner, repoName } = opts;
  const url = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;

  const response = await fetchFn(url, {
    headers: { "User-Agent": "FileFlow-Updater", Accept: "application/vnd.github.v3+json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to check for updates (HTTP ${response.status})`);
  }

  const release = (await response.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] };
  const latestVersion = release.tag_name.replace(/^v/, "");

  const asset = release.assets.find((a) => a.name === "fileflow.exe");
  if (!asset) {
    throw new Error("fileflow.exe not found in release assets");
  }

  if (latestVersion === currentVersion) {
    return { available: false, latestVersion };
  }

  return { available: true, latestVersion, downloadUrl: asset.browser_download_url };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/updater.test.ts`
Expected: 4 PASS

**Step 5: Commit**

```
git add src/updater.ts src/updater.test.ts
git commit -m "Add checkForUpdate with version comparison and GitHub API" -m "Introduces src/updater.ts with a dependency-injected checkForUpdate function that queries GitHub releases API and compares against the current version. All HTTP calls are injected for testability."
```

---

### Task 2: Add `performUpdate` to updater module

**Files:**
- Modify: `src/updater.ts`
- Modify: `src/updater.test.ts`

**Step 1: Write the failing tests for `performUpdate`**

Append to `src/updater.test.ts`:

```typescript
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";

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
```

**Step 2: Run test to verify it fails**

Run: `bun test src/updater.test.ts`
Expected: FAIL — `performUpdate` is not exported.

**Step 3: Implement `performUpdate`**

Add to `src/updater.ts`:

```typescript
import { writeFileSync, renameSync, unlinkSync, existsSync } from "fs";

export interface PerformUpdateOptions {
  exePath: string;
  downloadUrl: string;
  fetchFn: typeof fetch;
}

export interface UpdateResult {
  success: boolean;
}

export async function performUpdate(opts: PerformUpdateOptions): Promise<UpdateResult> {
  const { exePath, downloadUrl, fetchFn } = opts;
  const newPath = exePath + ".new";
  const oldPath = exePath + ".old";

  // Download to .new
  const response = await fetchFn(downloadUrl, {
    headers: { "User-Agent": "FileFlow-Updater" },
  });

  if (!response.ok) {
    throw new Error(`Failed to download update (HTTP ${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  writeFileSync(newPath, Buffer.from(buffer));

  // Rename-aside: current -> .old, .new -> current
  try {
    if (existsSync(oldPath)) unlinkSync(oldPath);
    renameSync(exePath, oldPath);
    renameSync(newPath, exePath);
  } catch (e) {
    // Attempt rollback
    try {
      if (existsSync(oldPath) && !existsSync(exePath)) {
        renameSync(oldPath, exePath);
      }
      if (existsSync(newPath)) unlinkSync(newPath);
    } catch {}
    throw new Error(`Failed to replace binary: ${e}`);
  }

  return { success: true };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/updater.test.ts`
Expected: 6 PASS (4 from Task 1 + 2 new)

**Step 5: Commit**

```
git add src/updater.ts src/updater.test.ts
git commit -m "Add performUpdate with rename-aside binary replacement" -m "Downloads the new binary to a .new temp file, renames the running exe to .old, then renames .new into place. Includes rollback on rename failure and cleanup of partial downloads."
```

---

### Task 3: Add `cleanupOldBinary` helper

**Files:**
- Modify: `src/updater.ts`
- Modify: `src/updater.test.ts`

**Step 1: Write the failing test**

Append to `src/updater.test.ts`:

```typescript
describe("cleanupOldBinary", () => {
  const tmpDir = join(process.env.TEMP || "/tmp", "fileflow_test_cleanup");

  function cleanup() {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  test("deletes .old file when it exists", () => {
    cleanup();
    mkdirSync(tmpDir, { recursive: true });
    const oldPath = join(tmpDir, "fileflow.exe.old");
    writeFileSync(oldPath, "stale");

    cleanupOldBinary(join(tmpDir, "fileflow.exe"));

    expect(existsSync(oldPath)).toBe(false);
    cleanup();
  });

  test("does nothing when .old file does not exist", () => {
    cleanup();
    mkdirSync(tmpDir, { recursive: true });

    // Should not throw
    cleanupOldBinary(join(tmpDir, "fileflow.exe"));
    cleanup();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/updater.test.ts`
Expected: FAIL — `cleanupOldBinary` is not exported.

**Step 3: Implement `cleanupOldBinary`**

Add to `src/updater.ts`:

```typescript
export function cleanupOldBinary(exePath: string): void {
  const oldPath = exePath + ".old";
  try {
    if (existsSync(oldPath)) unlinkSync(oldPath);
  } catch {
    // Best-effort cleanup, ignore errors (file may be locked)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/updater.test.ts`
Expected: 8 PASS

**Step 5: Commit**

```
git add src/updater.ts src/updater.test.ts
git commit -m "Add cleanupOldBinary for startup housekeeping" -m "Deletes the .old file left behind from a previous update. Called at startup before any command processing. Silently ignores errors if the file is locked or missing."
```

---

### Task 4: Wire --update into CLI entry point

**Files:**
- Modify: `src/index.ts`

**Step 1: Add --update flag to parseArgs**

In `src/index.ts`, add to the options object:

```typescript
update: { type: "boolean", default: false },
```

**Step 2: Add --update to help text**

Add this line to the help output:

```
  --update          Update to latest version
```

**Step 3: Add imports and startup cleanup**

Add to imports:

```typescript
import { checkForUpdate, performUpdate, cleanupOldBinary } from "./updater";
```

Right after `const VERSION = "0.1.0";` add:

```typescript
// Clean up leftover .old binary from previous update
cleanupOldBinary(resolve(process.argv[0]!));
```

**Step 4: Add --update handler block**

After the `--help` block and before `const configPath`, add:

```typescript
if (values.update) {
  const exePath = resolve(process.argv[0]!);
  console.log(`Current version: ${VERSION}`);
  console.log("Checking for updates...");
  try {
    const result = await checkForUpdate({
      currentVersion: VERSION,
      fetchFn: fetch,
      repoOwner: "theyagizsina",
      repoName: "fileflow",
    });
    if (!result.available) {
      console.log("Already up to date.");
      process.exit(0);
    }
    console.log(`v${result.latestVersion} available`);
    console.log("Downloading fileflow.exe...");
    await performUpdate({
      exePath,
      downloadUrl: result.downloadUrl!,
      fetchFn: fetch,
    });
    console.log(`Updated to v${result.latestVersion}. Restart fileflow to use the new version.`);
  } catch (e) {
    console.error(`Update failed: ${e}`);
    process.exit(1);
  }
  process.exit(0);
}
```

**Step 5: Run full test suite**

Run: `bun test`
Expected: All tests pass (previous 129 + 8 new updater tests = 137)

**Step 6: Commit**

```
git add src/index.ts
git commit -m "Wire --update command into CLI entry point" -m "Adds --update flag that checks GitHub for the latest release, downloads the new binary, and replaces it using rename-aside. Also cleans up leftover .old files from previous updates on every startup."
```

---

### Task 5: Integration smoke test and final push

**Step 1: Run full test suite one more time**

Run: `bun test`
Expected: All tests pass.

**Step 2: Manual smoke test**

Run: `bun run src/index.ts --help`
Expected: Output includes `--update` in the options list.

**Step 3: Push and optionally tag**

```
git push
```
