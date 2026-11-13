//! Where things live.
use std::path::PathBuf;

/// The executable's name (15 characters: where Linux truncates process names, so the instance check still matches).
pub const BIN_NAME: &str = "magica-terminal";
/// The config folder's name, under the OS's config dir.
pub const APP_DIR_NAME: &str = "magica-terminal";

/// `~/.config/<APP_DIR_NAME>` on Linux, `~/Library/Application Support/<…>` on macOS, `%APPDATA%\<…>` on Windows.
pub fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join(APP_DIR_NAME)
}

/// A file in the config folder.
pub fn file(name: &str) -> PathBuf {
    config_dir().join(name)
}
