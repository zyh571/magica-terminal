# Build and install Magica Terminal from this checkout (Windows). Run it again after `git pull` or an edit.
#   .\install.ps1          build, then put it on your PATH and in the Start Menu
#   .\install.ps1 -Yes     install whatever the build needs without asking first
# It needs nothing but this checkout: the C++ build tools, Rust, Node.js and WebView2 are installed (or updated)
# when missing, straight from their makers, so winget isn't needed either.
param([switch]$Yes)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Windows PowerShell downloads many times slower while drawing a progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$dir = Join-Path $PSScriptRoot 'app'
$binName = ([regex]::Match((Get-Content -Raw (Join-Path $dir 'core\src\paths.rs')), 'pub const BIN_NAME: &str = "(.*)";')).Groups[1].Value
$rustMin = [version]'1.90'   # the highest rust-version among the crates in app\Cargo.lock
$tools = Join-Path $env:LOCALAPPDATA 'magica-terminal-build'   # a private Node.js, when the system's is missing or too old
$arm = ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') -or ($env:PROCESSOR_ARCHITEW6432 -eq 'ARM64')
$triple = if ($arm) { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$vcTools = if ($arm) { 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' } else { 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' }
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$cargoBin = if ($env:CARGO_HOME) { Join-Path $env:CARGO_HOME 'bin' } else { "$env:USERPROFILE\.cargo\bin" }

function Update-Path {   # pick up what an installer just added, without opening a new shell
  $env:PATH = "$tools\node;$cargoBin;" + [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')
}
function Confirm-Step([string]$question) {   # yes unless answered n; no when there's nobody to ask (unless -Yes)
  if ($Yes) { return $true }
  if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) { return $false }
  -not ((Read-Host "$question [Y/n]") -match '^[nN]')
}
function Get-Output([string]$exe, [string[]]$arguments) {   # a program's output, or $null when it's missing or fails
  $ErrorActionPreference = 'Continue'
  if (-not (Get-Command $exe -CommandType Application -ErrorAction SilentlyContinue)) { return $null }
  try {
    $out = & $exe @arguments 2>$null | Out-String
    if ($LASTEXITCODE -eq 0) { $out } else { $null }
  } catch { $null }
}
function Save-Url([string]$url, [string]$file) {
  Write-Host "downloading $url ..."
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file
}
function Invoke-Installer([string]$exe, [string[]]$arguments) {   # waits for it; 3010 means "done, restart later"
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -Wait -PassThru
  if ($p.ExitCode -notin 0, 3010) { Write-Host "  (it exited with $($p.ExitCode))" }
}

function Test-Msvc {   # the C++ compiler and linker, and a Windows SDK for them to link against
  if (-not (Test-Path $vswhere)) { return $false }
  $vs = Get-Output $vswhere @('-latest', '-products', '*', '-requires', $vcTools, '-property', 'installationPath')
  if (-not $vs -or -not $vs.Trim()) { return $false }
  $kits = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots' -ErrorAction SilentlyContinue).KitsRoot10
  if (-not $kits) { $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\" }
  $sdkArch = if ($arm) { 'arm64' } else { 'x64' }
  [bool](Get-ChildItem -Path (Join-Path $kits 'Lib') -Filter kernel32.lib -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Directory.Name -eq $sdkArch -and $_.Directory.Parent.Name -eq 'um' } | Select-Object -First 1)
}
function Test-Rust {   # cargo that runs, a new enough rustc, and the MSVC flavour of it
  $v = Get-Output rustc @('-vV')
  if (-not $v -or $v -notmatch 'release: (\d+\.\d+\.\d+)' -or [version]$Matches[1] -lt $rustMin) { return $false }
  if ($v -notmatch 'host: .*-msvc') { return $false }
  [bool](Get-Output cargo @('--version'))
}
function Test-Node {   # what Vite 8 accepts: 20.19+ or 22.12+
  $v = Get-Output node @('--version')
  if (-not $v -or $v -notmatch 'v(\d+)\.(\d+)\.(\d+)') { return $false }
  $ver = [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
  $okVersion = if ($ver.Major -eq 20) { $ver -ge [version]'20.19.0' } elseif ($ver.Major -eq 21) { $false } else { $ver -ge [version]'22.12.0' }
  $okVersion -and [bool](Get-Output npm.cmd @('--version'))
}
function Test-WebView2 {   # Windows 11 ships it; older Windows 10 may not have it
  $id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  foreach ($key in "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$id", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$id", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$id") {
    $pv = (Get-ItemProperty $key -ErrorAction SilentlyContinue).pv
    if ($pv -and $pv -ne '0.0.0.0') { return $true }
  }
  $false
}

function Install-Msvc {
  $components = @('--add', $vcTools, '--add', 'Microsoft.VisualStudio.Component.Windows11SDK.22621', '--includeRecommended', '--passive', '--norestart', '--wait')
  $existing = if (Test-Path $vswhere) { Get-Output $vswhere @('-latest', '-products', '*', '-property', 'installationPath') }
  if ($existing -and $existing.Trim()) {
    # Visual Studio (or its Build Tools) is there without the C++ part: add it to that install
    Invoke-Installer "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe" (@('modify', '--installPath', "`"$($existing.Trim())`"") + $components)
  } else {
    $exe = Join-Path $env:TEMP 'vs_BuildTools.exe'
    Save-Url 'https://aka.ms/vs/17/release/vs_BuildTools.exe' $exe
    Invoke-Installer $exe $components
    Remove-Item -Force -ErrorAction SilentlyContinue $exe
  }
}
function Install-Rust {
  $rustup = Get-Command rustup -CommandType Application -ErrorAction SilentlyContinue
  if ($rustup) {
    # rustup with no default toolchain, an old one or a GNU one: build with an up-to-date MSVC stable, default untouched
    Write-Host "Rust here is missing a toolchain, older than $rustMin or not the MSVC kind; getting stable-$triple (rustup)..."
    $ErrorActionPreference = 'Continue'
    & $rustup.Source toolchain install "stable-$triple" --profile minimal
    if ($LASTEXITCODE -eq 0) {
      $env:RUSTUP_TOOLCHAIN = "stable-$triple"
      $env:PATH = "$(Split-Path $rustup.Source);$env:PATH"
    }
    $ErrorActionPreference = 'Stop'
  }
  if (Test-Rust) { return }
  $exe = Join-Path $env:TEMP 'rustup-init.exe'
  Save-Url "https://static.rust-lang.org/rustup/dist/$triple/rustup-init.exe" $exe
  Invoke-Installer $exe @('-y', '--profile', 'minimal', '--default-toolchain', 'stable', '--default-host', $triple)
  Remove-Item -Force -ErrorAction SilentlyContinue $exe
  Update-Path
}
function Install-Node {   # a private copy from nodejs.org, checked against its published checksum
  $base = 'https://nodejs.org/dist/latest-v24.x'
  $suffix = if ($arm) { '-win-arm64.zip' } else { '-win-x64.zip' }
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content -split "`n"
  $line = $sums | Where-Object { $_.TrimEnd().EndsWith($suffix) } | Select-Object -First 1
  if (-not $line) { throw "nodejs.org lists no $suffix build" }
  $hash, $file = -split $line
  $zip = Join-Path $env:TEMP $file
  Save-Url "$base/$file" $zip
  if ((Get-FileHash -Algorithm SHA256 $zip).Hash -ne $hash.ToUpper()) { Remove-Item -Force $zip; throw "the Node.js download doesn't match its checksum" }
  $unpack = Join-Path $tools 'node-unpack'
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $unpack, (Join-Path $tools 'node')
  Expand-Archive -Path $zip -DestinationPath $unpack
  Move-Item (Get-ChildItem $unpack -Directory | Select-Object -First 1).FullName (Join-Path $tools 'node')
  Remove-Item -Recurse -Force $unpack, $zip
}
function Install-WebView2 {
  $exe = Join-Path $env:TEMP 'MicrosoftEdgeWebview2Setup.exe'
  Save-Url 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' $exe
  Invoke-Installer $exe @('/silent', '/install')
  Remove-Item -Force -ErrorAction SilentlyContinue $exe
}

Update-Path
# in this order: rustup-init wants the C++ tools to be there already
$steps = @(
  [pscustomobject]@{ name = 'C++ build tools and a Windows SDK (Visual Studio Build Tools, asks for admin)'; test = { Test-Msvc }; install = { Install-Msvc } },
  [pscustomobject]@{ name = "Rust $rustMin+ (rustup)"; test = { Test-Rust }; install = { Install-Rust } },
  [pscustomobject]@{ name = 'Node.js 22.12+ (a private copy from nodejs.org)'; test = { Test-Node }; install = { Install-Node } },
  [pscustomobject]@{ name = 'the WebView2 runtime (asks for admin)'; test = { Test-WebView2 }; install = { Install-WebView2 } }
)
$todo = @($steps | Where-Object { -not (& $_.test) })
if ($todo.Count) {
  Write-Host 'Magica Terminal needs these to build and run:'
  $todo | ForEach-Object { Write-Host "  $($_.name)" }
  if (Confirm-Step 'Install them now?') {
    foreach ($s in $todo) {
      Write-Host "installing $($s.name)..."
      try { & $s.install } catch { Write-Host "  that didn't work: $($_.Exception.Message)" }
      Update-Path
    }
  }
  $still = @($steps | Where-Object { -not (& $_.test) })
  if ($still.Count) {
    Write-Host "Still missing: $(($still | ForEach-Object name) -join '; ')."
    if (-not $Yes) { Write-Host 'Run .\install.ps1 -Yes to install them, or install them yourself and run .\install.ps1 again.' }
    exit 1
  }
}

# settings from the environment that would send the build elsewhere or leave out the build tools
$env:CARGO_TARGET_DIR = Join-Path $dir 'target'
Remove-Item -ErrorAction SilentlyContinue Env:CARGO_BUILD_TARGET, Env:NODE_ENV
Push-Location $dir
try {
  # npm.cmd rather than npm: npm.ps1 is refused where PowerShell scripts aren't allowed
  npm.cmd ci --no-audit --no-fund --include=dev --include=optional
  if ($LASTEXITCODE) {
    Write-Host 'npm ci failed; trying again with a fresh npm cache...'
    npm.cmd ci --no-audit --no-fund --include=dev --include=optional --cache (Join-Path $tools 'npm-cache')
    if ($LASTEXITCODE) { throw 'npm ci failed' }
  }
  npm.cmd run tauri -- build --no-bundle
  if ($LASTEXITCODE) { throw 'the build failed' }
} finally { Pop-Location }


$target = Join-Path $env:LOCALAPPDATA 'Programs\magica-terminal'
if (Get-Process -Name $binName -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target\*" }) {
  Write-Host 'Magica Terminal is running; close its windows and run .\install.ps1 again.'
  exit 1
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Force (Join-Path $dir "target\release\$binName.exe") $target
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $target 'magica-dev.exe')   # the pre-release name
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
$s.Arguments = ''   # the old Electron shortcut passed its folder (its Ctrl+Alt+T key is kept)
$s.IconLocation = Join-Path $target "$binName.exe"
$s.WorkingDirectory = $env:USERPROFILE
$s.Save()

# The shortcut carries the app's id (System.AppUserModel.ID). The installed app sends its notifications ("finished
# after 1m 3s") under that id, and Windows drops them unless a Start Menu shortcut has it. WScript.Shell can't set it.
$appId = (Get-Content -Raw (Join-Path $dir 'src-tauri\tauri.conf.json') | ConvertFrom-Json).identifier
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MagicaShortcut {
  [ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CShellLink {}
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
  interface IPersistFile {
    void GetClassID(out Guid id);
    [PreserveSig] int IsDirty();
    void Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    void Save([MarshalAs(UnmanagedType.LPWStr)] string file, bool remember);
    void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
  }
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PropertyKey { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] struct PropVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  interface IPropertyStore {
    void GetCount(out uint n);
    void GetAt(uint i, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant v);
    void SetValue(ref PropertyKey key, ref PropVariant v);
    void Commit();
  }
  public static void SetAppId(string lnk, string appId) {
    var link = new CShellLink();
    ((IPersistFile)link).Load(lnk, 2);   // STGM_READWRITE
    var key = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };   // System.AppUserModel.ID
    var v = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(appId) };   // VT_LPWSTR
    try {
      var store = (IPropertyStore)link;
      store.SetValue(ref key, ref v);
      store.Commit();
      ((IPersistFile)link).Save(lnk, true);
    } finally {
      Marshal.FreeCoTaskMem(v.p);
      Marshal.ReleaseComObject(link);
    }
  }
}
"@
[MagicaShortcut]::SetAppId($lnk, $appId)
Write-Host "installed $target\$binName.exe and a Start Menu shortcut"
