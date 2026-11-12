//! session.json: the windows' tabs, splits, characters, folders and text, saved on close and restored on launch.
use crate::fsio::write_file;
use serde_json::Value;
use std::path::Path;

/// The saved session, or None if there's none, it's unreadable, or it has no tabs.
pub fn load(path: &Path) -> Option<Value> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    if v.get("tabs")?.as_array()?.is_empty() {
        return None;
    }
    Some(v)
}

/// Save the session (JSON from the window), readable only by you: the panes' text may hold secrets.
pub fn save(path: &Path, json: &str) -> bool {
    serde_json::from_str::<Value>(json).is_ok() && write_file(path, json, true)
}

/// Forget it (the last shell exited).
pub fn clear(path: &Path) {
    write_file(path, r#"{"tabs": []}"#, true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_or_corrupt_is_none() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("session.json");
        assert!(load(&p).is_none());
        std::fs::write(&p, r#"{"tabs": [{"char": "madoka""#).unwrap();
        assert!(load(&p).is_none());
        std::fs::write(&p, r#"{"tabs": []}"#).unwrap();
        assert!(load(&p).is_none());
        std::fs::write(&p, r#"[1]"#).unwrap();
        assert!(load(&p).is_none());
    }

    #[test]
    fn round_trip_is_private() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("session.json");
        let s = r#"{"size": [800, 600], "current": 0, "tabs": [{"char": "homura", "cwd": "/tmp/Zoë dir", "text": "$ ls"}]}"#;
        assert!(save(&p, s));
        assert_eq!(load(&p).unwrap()["tabs"][0]["cwd"], "/tmp/Zoë dir");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn save_rejects_non_json() {
        let d = tempfile::tempdir().unwrap();
        assert!(!save(&d.path().join("s.json"), "nope"));
    }

    #[test]
    fn clear_empties_it() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("session.json");
        save(&p, r#"{"tabs": [{"char": "madoka"}]}"#);
        clear(&p);
        assert!(load(&p).is_none());
    }

    #[test]
    fn old_python_session_loads() {
        let s = include_str!("../tests/python-session.json");
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("session.json");
        std::fs::write(&p, s).unwrap();
        let v = load(&p).unwrap();
        assert_eq!(v["tabs"].as_array().unwrap().len(), 2);
    }
}
