param(
  [switch]$RemoveData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Remove-UserPathEntry {
  param([Parameter(Mandatory = $true)][string]$Entry)

  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  if ([string]::IsNullOrWhiteSpace($current)) {
    return
  }

  $parts = $current.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)
  $kept = New-Object System.Collections.Generic.List[string]
  foreach ($part in $parts) {
    if ($part.Trim().ToLowerInvariant() -ne $Entry.Trim().ToLowerInvariant()) {
      [void]$kept.Add($part)
    }
  }

  $newValue = ($kept -join ";")
  [Environment]::SetEnvironmentVariable("Path", $newValue, "User")
}

function Uninstall-FileFlow {
  [CmdletBinding()]
  param(
    [switch]$RemoveData
  )

  $installRoot = Join-Path $env:LOCALAPPDATA "FileFlow"
  $binDir = Join-Path $installRoot "bin"
  $exePath = Join-Path $binDir "fileflow.exe"
  $configDir = Join-Path $env:APPDATA "FileFlow"

  if (Test-Path $exePath) {
    Write-Host "Removing startup task..."
    & $exePath --uninstall
  } else {
    Write-Host "Binary not found at $exePath, skipping --uninstall call."
  }

  Remove-UserPathEntry -Entry $binDir
  Write-Host "Removed PATH entry: $binDir"

  if ($RemoveData) {
    if (Test-Path $installRoot) {
      Remove-Item -Path $installRoot -Recurse -Force
      Write-Host "Removed install directory: $installRoot"
    }
    if (Test-Path $configDir) {
      Remove-Item -Path $configDir -Recurse -Force
      Write-Host "Removed config directory: $configDir"
    }
  }

  Write-Host "FileFlow uninstall complete."
}

if ($MyInvocation.InvocationName -ne ".") {
  Uninstall-FileFlow -RemoveData:$RemoveData
}
