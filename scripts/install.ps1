param(
  [string]$Version,
  [string[]]$WatchPaths,
  [string]$DestinationRoot,
  [string]$ConfigPath,
  [switch]$ForceConfig,
  [string]$RepoOwner = "theyagizsina",
  [string]$RepoName = "fileflow",
  [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ReleaseAssetUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$AssetName,
    [Parameter(Mandatory = $true)][string]$RepoOwner,
    [Parameter(Mandatory = $true)][string]$RepoName
  )

  $v = $Version.Trim()
  if ([string]::IsNullOrWhiteSpace($v)) {
    throw "Version is required. Example: -Version v0.1.0-alpha.1"
  }
  if (-not $v.StartsWith("v")) {
    $v = "v$v"
  }

  return "https://github.com/$RepoOwner/$RepoName/releases/download/$v/$AssetName"
}

function Add-UserPathEntry {
  param([Parameter(Mandatory = $true)][string]$Entry)

  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if (-not [string]::IsNullOrWhiteSpace($current)) {
    $parts = $current.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)
  }

  $exists = $false
  foreach ($part in $parts) {
    if ($part.Trim().ToLowerInvariant() -eq $Entry.Trim().ToLowerInvariant()) {
      $exists = $true
      break
    }
  }

  if (-not $exists) {
    $newValue = if ([string]::IsNullOrWhiteSpace($current)) { $Entry } else { "$current;$Entry" }
    [Environment]::SetEnvironmentVariable("Path", $newValue, "User")
    $env:Path = "$env:Path;$Entry"
    Write-Host "Added to user PATH: $Entry"
  } else {
    Write-Host "User PATH already contains: $Entry"
  }
}

function Read-HostWithDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [Parameter(Mandatory = $true)][string]$DefaultValue
  )

  $raw = Read-Host "$Prompt [$DefaultValue]"
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $DefaultValue
  }
  return $raw.Trim()
}

function Read-HostYesNo {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [bool]$DefaultYes = $true
  )

  $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
  $raw = Read-Host "$Prompt $suffix"
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $DefaultYes
  }

  $v = $raw.Trim().ToLowerInvariant()
  return ($v -eq "y" -or $v -eq "yes")
}

function Escape-TomlString {
  param([Parameter(Mandatory = $true)][string]$Value)
  return $Value.Replace('\', '\\').Replace('"', '\\"')
}

function Get-DefaultWatchPaths {
  return @(
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop")
  )
}

function Resolve-ProductRoot {
  param([string]$DestinationRoot)

  if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    return (Join-Path $env:USERPROFILE "FileFlow")
  }

  $full = [System.IO.Path]::GetFullPath($DestinationRoot)
  $leaf = Split-Path -Path $full -Leaf
  if ($leaf.ToLowerInvariant() -eq "fileflow") {
    return $full
  }

  return (Join-Path $full "FileFlow")
}

function Get-DefaultRules {
  param(
    [Parameter(Mandatory = $true)][string]$ProductRoot
  )

  return @(
    [PSCustomObject]@{ Name = "Screenshots"; Type = "pattern"; Match = @("Screenshot*", "Screen Shot*", "Ekran goruntusu*", "Clipboard*", "Snipaste*", "ShareX*", "Lightshot*", "Greenshot*"); Destination = (Join-Path $ProductRoot "Media\Screenshots") },
    [PSCustomObject]@{ Name = "Photos"; Type = "pattern"; Match = @("IMG_*", "DSC_*", "DCIM*", "PXL_*", "DSCF*", "Photo*"); Destination = (Join-Path $ProductRoot "Media\Images") },
    [PSCustomObject]@{ Name = "Design Files"; Type = "extension"; Match = @(".fig", ".xd", ".sketch", ".psd", ".ai", ".indd", ".afdesign", ".afphoto"); Destination = (Join-Path $ProductRoot "Design") },
    [PSCustomObject]@{ Name = "Videos"; Type = "extension"; Match = @(".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v"); Destination = (Join-Path $ProductRoot "Media\Videos") },
    [PSCustomObject]@{ Name = "Audio"; Type = "extension"; Match = @(".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma"); Destination = (Join-Path $ProductRoot "Media\Audio") },
    [PSCustomObject]@{ Name = "Images"; Type = "extension"; Match = @(".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg", ".ico", ".raw", ".cr2", ".nef"); Destination = (Join-Path $ProductRoot "Media\Images") },
    [PSCustomObject]@{ Name = "Documents"; Type = "extension"; Match = @(".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".txt", ".rtf", ".csv"); Destination = (Join-Path $ProductRoot "Downloads\Documents") },
    [PSCustomObject]@{ Name = "Archives"; Type = "extension"; Match = @(".zip", ".rar", ".7z", ".tar", ".gz", ".bz2"); Destination = (Join-Path $ProductRoot "Downloads\Archives") },
    [PSCustomObject]@{ Name = "Code"; Type = "extension"; Match = @(".js", ".ts", ".py", ".html", ".css", ".json", ".yaml", ".yml", ".xml", ".sql", ".sh", ".bat", ".ps1", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".php", ".swift", ".kt", ".lua", ".r", ".md"); Destination = (Join-Path $ProductRoot "Downloads\Code") },
    [PSCustomObject]@{ Name = "Fonts"; Type = "extension"; Match = @(".ttf", ".otf", ".woff", ".woff2", ".eot"); Destination = (Join-Path $ProductRoot "Downloads\Fonts") },
    [PSCustomObject]@{ Name = "Setup"; Type = "extension"; Match = @(".exe", ".msi", ".appx", ".msix", ".iso", ".img"); Destination = (Join-Path $ProductRoot "Downloads\Setup") }
  )
}

function Build-GeneratedConfig {
  param(
    [Parameter(Mandatory = $true)][string[]]$WatchPaths,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)]$Rules
  )

  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine("[watch]")
  [void]$sb.AppendLine("paths = [")
  for ($i = 0; $i -lt $WatchPaths.Count; $i++) {
    $escaped = Escape-TomlString $WatchPaths[$i]
    $suffix = if ($i -lt $WatchPaths.Count - 1) { "," } else { "" }
    [void]$sb.AppendLine("  `"$escaped`"$suffix")
  }
  [void]$sb.AppendLine("]")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("[safety]")
  [void]$sb.AppendLine('ignore_extensions = [".tmp", ".crdownload", ".part", ".partial", ".download", ".opdownload"]')
  [void]$sb.AppendLine("stability_delay_seconds = 3")
  [void]$sb.AppendLine("retry_interval_seconds = 10")
  [void]$sb.AppendLine("max_retries = 30")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("[logging]")
  [void]$sb.AppendLine("path = `"$(Escape-TomlString $LogPath)`"")
  [void]$sb.AppendLine("max_size_mb = 10")
  [void]$sb.AppendLine("rotate = true")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("[notifications]")
  [void]$sb.AppendLine("enabled = false")
  [void]$sb.AppendLine("")
  [void]$sb.AppendLine("# Rules are evaluated top-to-bottom. First match wins.")

  foreach ($rule in $Rules) {
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("[[rules]]")
    [void]$sb.AppendLine("name = `"$(Escape-TomlString $rule.Name)`"")
    [void]$sb.AppendLine("type = `"$($rule.Type)`"")
    $matchItems = $rule.Match | ForEach-Object { "`"$(Escape-TomlString $_)`"" }
    [void]$sb.AppendLine("match = [$($matchItems -join ", ")]")
    [void]$sb.AppendLine("destination = `"$(Escape-TomlString $rule.Destination)`"")
  }

  return $sb.ToString()
}

function Ensure-RuleDestinationPaths {
  param(
    [Parameter(Mandatory = $true)][string]$ConfigPath
  )

  try {
    $toml = Get-Content -Path $ConfigPath -Raw
    $matches = [System.Text.RegularExpressions.Regex]::Matches($toml, 'destination\s*=\s*"([^"]+)"')
    if ($matches.Count -eq 0) {
      return
    }

    $destinations = New-Object System.Collections.Generic.List[string]
    foreach ($m in $matches) {
      $raw = $m.Groups[1].Value
      $expanded = [System.Text.RegularExpressions.Regex]::Replace(
        $raw,
        '%([^%]+)%',
        [System.Text.RegularExpressions.MatchEvaluator]{
          param($envMatch)
          $key = $envMatch.Groups[1].Value
          $value = [Environment]::GetEnvironmentVariable($key)
          if ([string]::IsNullOrEmpty($value)) { return "" }
          return $value
        }
      )

      if (-not [string]::IsNullOrWhiteSpace($expanded)) {
        [void]$destinations.Add($expanded)
      }
    }

    if ($destinations.Count -gt 0) {
      Ensure-Directories -Paths ($destinations | Select-Object -Unique)
    }
  } catch {
    Write-Host "Warning: could not pre-create destination folders from config. Validation will still check paths."
  }
}

function Ensure-Directories {
  param([Parameter(Mandatory = $true)][string[]]$Paths)

  foreach ($path in $Paths) {
    if (-not [string]::IsNullOrWhiteSpace($path)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
  }
}

function Install-FileFlow {
  [CmdletBinding()]
  param(
    [string]$Version,
    [string[]]$WatchPaths,
    [string]$DestinationRoot,
    [string]$ConfigPath,
    [switch]$ForceConfig,
    [string]$RepoOwner,
    [string]$RepoName,
    [switch]$NonInteractive
  )

  if ([string]::IsNullOrWhiteSpace($Version)) {
    if ($NonInteractive) {
      throw "Version is required in non-interactive mode."
    }
    $Version = Read-Host "Release version (example: v0.1.0-alpha.1)"
    if ([string]::IsNullOrWhiteSpace($Version)) {
      throw "Version is required."
    }
  }

  if ([string]::IsNullOrWhiteSpace($RepoOwner)) {
    $RepoOwner = "theyagizsina"
  }
  if ([string]::IsNullOrWhiteSpace($RepoName)) {
    $RepoName = "fileflow"
  }

  if (-not $NonInteractive) {
    Write-Host ""
    Write-Host "FileFlow Installer"
    Write-Host "Repository: $RepoOwner/$RepoName"
    Write-Host "Version: $Version"
  }

  $installRoot = Join-Path $env:LOCALAPPDATA "FileFlow"
  $binDir = Join-Path $installRoot "bin"
  $exePath = Join-Path $binDir "fileflow.exe"

  if (-not $WatchPaths -or $WatchPaths.Count -eq 0) {
    $defaultWatchPaths = Get-DefaultWatchPaths
    if ($NonInteractive) {
      $WatchPaths = $defaultWatchPaths
    } else {
      Write-Host ""
      Write-Host "Default watch paths:"
      $defaultWatchPaths | ForEach-Object { Write-Host "  - $_" }
      if (Read-HostYesNo -Prompt "Use default watch paths?" -DefaultYes $true) {
        $WatchPaths = $defaultWatchPaths
      } else {
        $raw = Read-Host "Enter watch paths separated by comma"
        if ([string]::IsNullOrWhiteSpace($raw)) {
          throw "At least one watch path is required."
        }
        $WatchPaths = $raw.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 }
        if ($WatchPaths.Count -eq 0) {
          throw "At least one valid watch path is required."
        }
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $defaultDestination = Join-Path $env:USERPROFILE "FileFlow"
    if ($NonInteractive) {
      $DestinationRoot = $defaultDestination
    } else {
      $DestinationRoot = Read-HostWithDefault -Prompt "Destination base folder" -DefaultValue $defaultDestination
    }
  }

  $productRoot = Resolve-ProductRoot -DestinationRoot $DestinationRoot
  if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $defaultConfig = Join-Path (Join-Path $env:APPDATA "FileFlow") "fileflow.toml"
    if ($NonInteractive) {
      $ConfigPath = $defaultConfig
    } else {
      $ConfigPath = Read-HostWithDefault -Prompt "Config path" -DefaultValue $defaultConfig
    }
  }

  $configPath = [System.IO.Path]::GetFullPath($ConfigPath)
  $productRoot = [System.IO.Path]::GetFullPath($productRoot)
  $configDir = Split-Path -Path $configPath -Parent
  $logPath = Join-Path $installRoot "fileflow.log"
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  New-Item -ItemType Directory -Path $configDir -Force | Out-Null
  New-Item -ItemType Directory -Path $productRoot -Force | Out-Null
  Ensure-Directories -Paths $WatchPaths

  $downloadUrl = Get-ReleaseAssetUrl -Version $Version -AssetName "fileflow.exe" -RepoOwner $RepoOwner -RepoName $RepoName
  Write-Host "Downloading: $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -OutFile $exePath

  Add-UserPathEntry -Entry $binDir

  if (-not $ForceConfig -and (Test-Path $configPath) -and -not $NonInteractive) {
    $ForceConfig = (Read-HostYesNo -Prompt "Config already exists. Regenerate it?" -DefaultYes $false)
  }

  if ($ForceConfig -or -not (Test-Path $configPath)) {
    Write-Host "Generating config for this user profile..."
    $rules = Get-DefaultRules -ProductRoot $productRoot
    $configContent = Build-GeneratedConfig -WatchPaths $WatchPaths -LogPath $logPath -Rules $rules
    Set-Content -Path $configPath -Value $configContent -Encoding UTF8
    Write-Host "Generated config: $configPath"
    Write-Host "Watch paths:"
    $WatchPaths | ForEach-Object { Write-Host "  - $_" }
    Write-Host "Destination root: $productRoot"
  } else {
    Write-Host "Config already exists: $configPath"
    Write-Host "Use -ForceConfig to regenerate config with custom paths."
  }

  Ensure-RuleDestinationPaths -ConfigPath $configPath

  Write-Host "Running validation..."
  & $exePath --validate --config $configPath
  if ($LASTEXITCODE -ne 0) {
    throw "Validation failed. Check your config and destination permissions."
  }

  Write-Host "Installing startup task..."
  & $exePath --install --config $configPath
  if ($LASTEXITCODE -ne 0) {
    throw "Startup task installation failed."
  }

  Write-Host "Current status:"
  & $exePath --status --config $configPath

  Write-Host ""
  Write-Host "FileFlow installed successfully."
  Write-Host "Open a new terminal and run: fileflow --version"
}

if ($MyInvocation.InvocationName -ne ".") {
  Install-FileFlow -Version $Version -WatchPaths $WatchPaths -DestinationRoot $DestinationRoot -ConfigPath $ConfigPath -ForceConfig:$ForceConfig -RepoOwner $RepoOwner -RepoName $RepoName -NonInteractive:$NonInteractive
}
