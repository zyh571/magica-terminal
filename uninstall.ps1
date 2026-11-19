# Remove Magica Terminal on Windows. Pass -Purge to remove notes, settings and saved sessions too.
param([switch]$Purge)

$ErrorActionPreference = 'Stop'
$binName = 'magica-terminal'
$target = Join-Path $env:LOCALAPPDATA 'Programs\magica-terminal'

if (Get-Process -Name $binName -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target\*" }) {
  Write-Host 'Magica Terminal is running; close its windows and run .\uninstall.ps1 again.'
  exit 1
}

Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Magica Terminal.lnk'
Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
$kept = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $target.TrimEnd('\') })
[Environment]::SetEnvironmentVariable('PATH', ($kept -join ';'), 'User')

if ($Purge) {
  Remove-Item -LiteralPath (Join-Path $env:APPDATA 'magica-terminal') -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'uninstalled Magica Terminal and removed its saved data'
} else {
  Write-Host 'uninstalled Magica Terminal (notes, settings and sessions were kept)'
}
