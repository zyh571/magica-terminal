//! Whole-file writes that a crash can't leave half done.
use std::io::Write;
use std::path::Path;

/// Write `text` to `path` through a temporary file next to it, flushed to disk and renamed over the original, so a
/// crash leaves either the old contents or the new. `private`: only the owner can read it (0600 from the start on Unix).
/// Returns whether it worked; a failed write leaves no temporary file behind.
pub fn write_file(path: &Path, text: &str, private: bool) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.{}.tmp", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let _ = std::fs::remove_file(&tmp);
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(if private { 0o600 } else { 0o666 });
        }
        let _ = private;
        let mut f = opts.open(&tmp)?;
        f.write_all(text.as_bytes())?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_replaces_whole_file() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("sub/f.txt");
        assert!(write_file(&p, "a long first version", false));
        assert!(write_file(&p, "short", false));
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "short");
        assert_eq!(std::fs::read_dir(p.parent().unwrap()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn private_file_is_0600() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.json");
        assert!(write_file(&p, "{}", true));
        assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn no_tmp_left_on_failure() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let ro = d.path().join("ro");
        std::fs::create_dir(&ro).unwrap();
        std::fs::write(ro.join("f"), "old").unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o500)).unwrap();
        let ok = write_file(&ro.join("f"), "new", false);
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(!ok);
        assert_eq!(std::fs::read_to_string(ro.join("f")).unwrap(), "old");
        assert_eq!(std::fs::read_dir(&ro).unwrap().count(), 1);
    }
}
