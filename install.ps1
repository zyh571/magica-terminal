# Build and install Magica Terminal from this checkout (Windows). Run it again after `git pull` or an edit.
#   .\install.ps1
#   .\install.ps1 -Uninstall   remove the installed app and shortcut (keeps settings and sessions)
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'app'
$binName = ([regex]::Match((Get-Content -Raw (Join-Path $dir 'core\src\paths.rs')), 'pub const BIN_NAME: &str = "(.*)";')).Groups[1].Value
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

$target = Join-Path $env:LOCALAPPDATA 'Programs\magica-terminal'
$lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Magica Terminal.lnk'
if ($Uninstall) {
  if (Get-Process -Name $binName -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target\*" }) {
    Write-Host 'Magica Terminal is running; close its windows and run .\install.ps1 -Uninstall again.'
    exit 1
  }
  Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
  $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  $kept = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $target.TrimEnd('\') })
  [Environment]::SetEnvironmentVariable('PATH', ($kept -join ';'), 'User')
  Write-Host 'uninstalled Magica Terminal (settings and sessions were kept)'
  exit 0
}

function Find-Missing {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $msvc = (Test-Path $vswhere) -and (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
  $m = @()
  if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { $m += [pscustomobject]@{ name = 'Rust'; args = @('Rustlang.Rustup') } }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { $m += [pscustomobject]@{ name = 'Node.js'; args = @('OpenJS.NodeJS.LTS') } }
  if (-not $msvc) { $m += [pscustomobject]@{ name = 'C++ build tools'; args = @('Microsoft.VisualStudio.2022.BuildTools', '--override', '--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended') } }
  , $m
}
function Update-Path {   # pick up what winget just added, without opening a new shell
  $env:PATH = "$env:USERPROFILE\.cargo\bin;" + [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')
}

$missing = Find-Missing
if ($missing.Count) {
  Write-Host 'Magica Terminal needs these to build:'
  $missing | ForEach-Object { Write-Host "  $($_.name):  winget install $($_.args -join ' ')" }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Write-Host 'Install them, then run .\install.ps1 again.'; exit 1 }
  if ((Read-Host 'Install them now with winget? [Y/n]') -match '^[nN]') { exit 1 }
  foreach ($p in $missing) {
    Write-Host "installing $($p.name)…"
    winget install --exact --id $p.args[0] --accept-source-agreements --accept-package-agreements @($p.args | Select-Object -Skip 1)
  }
  Update-Path
  if ((Get-Command rustup -ErrorAction SilentlyContinue) -and -not (rustup toolchain list | Select-String 'msvc')) { rustup default stable-msvc }
  $missing = Find-Missing
  if ($missing.Count) {
    Write-Host "Still missing: $(($missing | ForEach-Object name) -join ', '). Open a new PowerShell window and run .\install.ps1 again."
    exit 1
  }
}

Push-Location $dir
try {
  npm ci --no-audit --no-fund
  npx tauri build --no-bundle
  if ($LASTEXITCODE) { throw 'the build failed' }
} finally { Pop-Location }

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
