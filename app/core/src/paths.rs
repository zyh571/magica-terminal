//! Where things live.
use std::path::PathBuf;

/// The executable's name. `magica-dev` until cutover: the old app looks for processes named `magica-terminal`
/// (15 characters, which is also where Linux truncates process names).
pub const BIN_NAME: &str = "magica-dev";
/// The config folder's name, under the OS's config dir.
pub const APP_DIR_NAME: &str = "magica-terminal-dev";

/// `~/.config/<APP_DIR_NAME>` on Linux, `~/Library/Application Support/<…>` on macOS, `%APPDATA%\<…>` on Windows.
pub fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join(APP_DIR_NAME)
}

/// A file in the config folder.
pub fn file(name: &str) -> PathBuf {
    config_dir().join(name)
}
