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

/// `\\?\C:\x` → `C:\x`. Windows PowerShell treats a `\\?\` path as a network share, so with the default
/// RemoteSigned policy it refuses to dot-source an unsigned script from it. `\\?\UNC\…` and other paths are kept.
pub fn plain(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') && rest.as_bytes()[0].is_ascii_alphabetic() => rest.into(),
        _ => p,
    }
}

#[cfg(test)]
mod tests {
    use super::plain;
    use std::path::PathBuf;

    #[test]
    fn plain_drops_the_verbatim_prefix_of_a_drive_path() {
        let p = |s: &str| plain(PathBuf::from(s)).to_string_lossy().into_owned();
        assert_eq!(p(r"\\?\C:\Users\u\shell"), r"C:\Users\u\shell");
        assert_eq!(p(r"\\?\UNC\server\share\shell"), r"\\?\UNC\server\share\shell");
        assert_eq!(p(r"C:\x"), r"C:\x");
        assert_eq!(p("/usr/lib/magica/shell"), "/usr/lib/magica/shell");
    }
}
