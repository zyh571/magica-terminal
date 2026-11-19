//! Remove the artifacts made by the source installers. User data is retained unless `--purge` was requested.

use crate::paths::{self, BIN_NAME};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::fs;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::io::ErrorKind;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::path::Path;
#[cfg(windows)]
use std::path::PathBuf;

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn remove_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn remove_dir(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn finish(purge: bool) -> Result<String, String> {
    if purge {
        remove_dir(&paths::config_dir())?;
        Ok("uninstalled Magica Terminal and removed its saved data\n".into())
    } else {
        Ok("uninstalled Magica Terminal (notes, settings and sessions were kept)\n".into())
    }
}

#[cfg(target_os = "linux")]
pub fn run(purge: bool) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("could not find your home folder")?;
    remove_file(&home.join(".local/bin").join(BIN_NAME))?;
    let applications = home.join(".local/share/applications");
    remove_file(&applications.join(format!("{BIN_NAME}.desktop")))?;
    let defaults = home.join(".config/ubuntu-xdg-terminals.list");
    remove_default(&defaults)?;
    let _ = std::process::Command::new("update-desktop-database").arg(&applications).status();
    finish(purge)
}

#[cfg(target_os = "linux")]
fn remove_default(path: &Path) -> Result<(), String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let entry = format!("{BIN_NAME}.desktop");
    let mut kept = text.lines().filter(|line| *line != entry).collect::<Vec<_>>().join("\n");
    if !kept.is_empty() {
        kept.push('\n');
    }
    crate::fsio::write_file(path, &kept, false).then_some(()).ok_or_else(|| format!("could not update {}", path.display()))
}

#[cfg(target_os = "macos")]
pub fn run(purge: bool) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("could not find your home folder")?;
    remove_file(&home.join(".local/bin").join(BIN_NAME))?;
    remove_dir(&home.join("Applications/Magica Terminal.app"))?;
    finish(purge)
}

#[cfg(windows)]
pub fn run(purge: bool) -> Result<String, String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const SCRIPT: &str = r#"
Wait-Process -Id ([int]$env:MAGICA_UNINSTALL_PID) -ErrorAction SilentlyContinue
while (Get-Process -Name 'magica-terminal' -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }
Remove-Item -LiteralPath $env:MAGICA_UNINSTALL_TARGET -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $env:MAGICA_UNINSTALL_SHORTCUT -Force -ErrorAction SilentlyContinue
$path = [Environment]::GetEnvironmentVariable('PATH', 'User')
$target = $env:MAGICA_UNINSTALL_TARGET.TrimEnd('\')
$kept = @($path -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $target })
[Environment]::SetEnvironmentVariable('PATH', ($kept -join ';'), 'User')
if ($env:MAGICA_UNINSTALL_PURGE -eq '1') {
  Remove-Item -LiteralPath $env:MAGICA_UNINSTALL_CONFIG -Recurse -Force -ErrorAction SilentlyContinue
}
"#;

    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).ok_or("LOCALAPPDATA is not set")?;
    let roaming = std::env::var_os("APPDATA").map(PathBuf::from).ok_or("APPDATA is not set")?;
    let target = local.join("Programs").join(BIN_NAME);
    let shortcut = roaming.join("Microsoft/Windows/Start Menu/Programs/Magica Terminal.lnk");
    std::process::Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SCRIPT])
        .env("MAGICA_UNINSTALL_PID", std::process::id().to_string())
        .env("MAGICA_UNINSTALL_TARGET", &target)
        .env("MAGICA_UNINSTALL_SHORTCUT", shortcut)
        .env("MAGICA_UNINSTALL_CONFIG", paths::config_dir())
        .env("MAGICA_UNINSTALL_PURGE", if purge { "1" } else { "0" })
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("could not start the Windows uninstaller: {e}"))?;
    Ok(if purge {
        "uninstall scheduled; close all Magica Terminal windows to finish and remove saved data\n"
    } else {
        "uninstall scheduled; close all Magica Terminal windows to finish (saved data will be kept)\n"
    }.into())
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    #[test]
    fn removes_only_magica_from_default_terminal_list() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("terminals.list");
        std::fs::write(&path, "other.desktop\nmagica-terminal.desktop\nfallback.desktop\n").unwrap();
        super::remove_default(&path).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "other.desktop\nfallback.desktop\n");
    }
}
