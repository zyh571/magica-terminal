# Build and install Magica Terminal from this checkout (Windows). Run it again after `git pull` or an edit.
#   .\install.ps1
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$binName = ([regex]::Match((Get-Content -Raw (Join-Path $dir 'core\src\paths.rs')), 'pub const BIN_NAME: &str = "(.*)";')).Groups[1].Value
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

$missing = @()
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { $missing += 'Rust: winget install Rustlang.Rustup   (then: rustup default stable-msvc)' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $missing += 'Node.js: winget install OpenJS.NodeJS.LTS' }
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msvc = (Test-Path $vswhere) -and (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $msvc) { $missing += 'C++ build tools: winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"' }
if ($missing.Count) {
  Write-Host 'Magica Terminal needs these first:'
  $missing | ForEach-Object { Write-Host "  $_" }
  exit 1
}

Push-Location $dir
try {
  npm ci --no-audit --no-fund
  npx tauri build --no-bundle
  if ($LASTEXITCODE) { throw 'the build failed' }
} finally { Pop-Location }

$target = Join-Path $env:LOCALAPPDATA 'Programs\magica-terminal'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Force (Join-Path $dir "target\release\$binName.exe") $target
# the shell scripts sit next to the exe (Tauri's resource folder for an unbundled build)
Copy-Item -Recurse -Force (Join-Path $dir 'shell') $target

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $target })) {
  [Environment]::SetEnvironmentVariable('PATH', "$userPath;$target", 'User')
  Write-Host "added $target to your PATH (new shells will see it)"
}
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Magica Terminal.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = Join-Path $target "$binName.exe"
$s.WorkingDirectory = $env:USERPROFILE
$s.Save()
Write-Host "installed $target\$binName.exe and a Start Menu shortcut"
