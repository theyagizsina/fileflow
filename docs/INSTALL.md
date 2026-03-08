# FileFlow Installation (Windows)

This installer flow is versioned and uses GitHub Releases from `theyagizsina/fileflow`.

Note: repository owner/name are configurable in the installer via `-RepoOwner` and `-RepoName`.

## Quick Install

Run in PowerShell:

```powershell
irm https://raw.githubusercontent.com/theyagizsina/fileflow/v0.1.0-alpha.1/scripts/install.ps1 | iex; Install-FileFlow
```

Interactive mode is now the default. If parameters are missing, installer prompts you in terminal.

What this does:

- Downloads `fileflow.exe` from release assets.
- Installs to `%LOCALAPPDATA%\FileFlow\bin\fileflow.exe`.
- Adds `%LOCALAPPDATA%\FileFlow\bin` to user PATH.
- Generates config at `%APPDATA%\FileFlow\fileflow.toml` for the current user.
- Runs `--validate`, `--install`, and `--status`.

By default, generated config values are:

- Watch paths: `%USERPROFILE%\\Downloads`, `%USERPROFILE%\\Desktop`
- Destination root: `%USERPROFILE%\\FileFlow`
- Log path: `%LOCALAPPDATA%\\FileFlow\\fileflow.log`

The installer generates missing directories automatically, including the FileFlow destination subfolder structure.

After installation, open a new terminal and run:

```powershell
fileflow --version
```

## Direct Script Usage

If you already downloaded the repo/scripts:

```powershell
.\scripts\install.ps1
```

If `-Version` is not provided, installer resolves the latest GitHub release automatically.

### Custom install paths

You can customize watch folders, destination root, and config location.

```powershell
.\scripts\install.ps1 \
  -Version v0.1.0-alpha.1 \
  -WatchPaths "D:\\Inbox","D:\\Shared\\Downloads" \
  -DestinationRoot "D:\\Sorted" \
  -ConfigPath "D:\\Apps\\FileFlow\\fileflow.toml" \
  -RepoOwner "theyagizsina" \
  -RepoName "fileflow" \
  -ForceConfig
```

### Non-interactive mode

Use this for automation/CI:

```powershell
.\scripts\install.ps1 \
  -Version v0.1.0-alpha.1 \
  -WatchPaths "D:\\Inbox","D:\\Shared\\Downloads" \
  -DestinationRoot "D:\\Sorted" \
  -ConfigPath "D:\\Apps\\FileFlow\\fileflow.toml" \
  -NonInteractive
```

Options:

- `-WatchPaths`: One or more folders to monitor. Missing folders are created.
- `-DestinationRoot`: Base folder for generated destinations. Installer always ensures a `FileFlow` root and creates rule subfolders under it.
- `-ConfigPath`: Exact config file location.
- `-ForceConfig`: Regenerates config even if it already exists.
- `-RepoOwner`: GitHub owner for release asset download.
- `-RepoName`: GitHub repository name for release asset download.

## Uninstall

Keep config/data:

```powershell
irm https://raw.githubusercontent.com/theyagizsina/fileflow/v0.1.0-alpha.1/scripts/uninstall.ps1 | iex; Uninstall-FileFlow
```

Remove all app data too:

```powershell
irm https://raw.githubusercontent.com/theyagizsina/fileflow/v0.1.0-alpha.1/scripts/uninstall.ps1 | iex; Uninstall-FileFlow -RemoveData
```

Direct script usage:

```powershell
.\scripts\uninstall.ps1
.\scripts\uninstall.ps1 -RemoveData
```
