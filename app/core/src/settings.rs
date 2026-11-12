//! settings.json: overrides for the defaults below, by their lower-case names.
use serde_json::{json, Map, Value};
use std::path::Path;

/// Settings whose value is a set of whole numbers (any length), not a fixed-length tuple.
const SETS: &[&str] = &["ignored_exit"];

/// Every setting and its default (the constants at the top of the old Python app; see the README).
pub fn defaults() -> Map<String, Value> {
    let v = json!({
        "font": "Maple Mono 11",
        "padding": 10,
        "fig_height": 240, "fig_right": 30, "fig_bottom": 12,
        "base_height": 5, "base_gap": 4,
        "figure_opacity": 0.35, "hover_opacity": 1, "text_opacity": 1, "text_full": 0.2, "text_contrast": 0.12,
        "fail_flash": 0.5, "fail_tint": 0.5, "fail_squash": 0.15, "fail_red": "#ff1f1f",
        "ignored_exit": [130],
        "long_command": 10, "hop_height": 22, "hops": 3, "jump_height": 20, "notify": true,
        "idle_after": 15, "idle_every": [6, 14], "idle_bob": 12, "idle_breath": 0.04,
        "frame_width": 0, "window_radius": 12, "unfocused_overlay": "transparent",
        "text_saturation": 0.55, "path_saturation": 0.4,
        "focus_brighten": {"dark": 0.0, "light": 0.0}, "focus_tint": 0.08, "unfocused_saturation": 1.0,
        "crush_size": 8, "crush_speed": 1.0, "crush_hint_after": 5, "crush_autoplay": false,
        "crush_autoplay_delay": 0.6, "crush_chain_luck": 0.4, "crush_lucky_stripes": 0.05, "crush_chain_fade": 0.72,
        "note_save_after": 0.4
    });
    match v {
        Value::Object(m) => m,
        _ => unreachable!(),
    }
}

fn valid(default: &Value, value: &Value, set: bool) -> bool {
    match (default, value) {
        (Value::Bool(_), v) => v.is_boolean(),
        (Value::Number(_), v) => v.is_number(),
        (Value::String(_), v) => v.is_string(),
        (Value::Array(_), Value::Array(vs)) if set => vs.iter().all(|v| v.is_i64() || v.is_u64()),
        (Value::Array(ds), Value::Array(vs)) => ds.len() == vs.len() && ds.iter().zip(vs).all(|(d, v)| valid(d, v, false)),
        (Value::Object(dm), Value::Object(vm)) => vm.iter().all(|(k, v)| dm.get(k).is_some_and(|d| valid(d, v, false))),
        _ => false,
    }
}

/// The settings: the defaults with `path`'s valid overrides applied, and a warning for each one ignored.
/// A missing file is no warning; an unreadable or malformed one is ignored as a whole.
pub fn load(path: &Path) -> (Map<String, Value>, Vec<String>) {
    let mut s = defaults();
    let mut warnings = Vec::new();
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (s, warnings),
        Err(e) => return (s, vec![format!("ignored ({e})")]),
    };
    let data = match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => m,
        Ok(_) => return (s, vec!["ignored (not a JSON object)".into()]),
        Err(e) => return (s, vec![format!("ignored ({e})")]),
    };
    for (key, value) in data {
        let name = key.to_lowercase();
        match s.get_mut(&name) {
            None => warnings.push(format!("unknown setting '{key}'")),
            Some(default) if !valid(default, &value, SETS.contains(&name.as_str())) => {
                warnings.push(format!("bad value for '{key}': {value}"))
            }
            Some(Value::Object(dm)) => {
                if let Value::Object(vm) = value {
                    dm.extend(vm);
                }
            }
            Some(slot) => *slot = value,
        }
    }
    (s, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_str(text: &str) -> (Map<String, Value>, Vec<String>) {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("settings.json");
        std::fs::write(&p, text).unwrap();
        load(&p)
    }

    #[test]
    fn missing_file_gives_defaults() {
        let (s, w) = load(Path::new("/nonexistent/settings.json"));
        assert!(w.is_empty());
        assert_eq!(s["fig_height"], json!(240));
        assert_eq!(s["idle_every"], json!([6, 14]));
        assert_eq!(s["ignored_exit"], json!([130]));
        assert_eq!(s["fail_red"], json!("#ff1f1f"));
        assert!(!s.contains_key("browser_home"));
    }

    #[test]
    fn overrides_known_names() {
        let (s, w) = load_str(r#"{"idle_bob": 16, "idle_every": [4, 8], "notify": false, "ignored_exit": [130, 1]}"#);
        assert!(w.is_empty(), "{w:?}");
        assert_eq!(s["idle_bob"], json!(16));
        assert_eq!(s["idle_every"], json!([4, 8]));
        assert_eq!(s["notify"], json!(false));
        assert_eq!(s["ignored_exit"], json!([130, 1]));
    }

    #[test]
    fn unknown_name_warns() {
        let (_, w) = load_str(r#"{"zzz": 1}"#);
        assert_eq!(w.len(), 1);
        assert!(w[0].contains("unknown setting 'zzz'"), "{w:?}");
    }

    #[test]
    fn browser_home_is_unknown() {
        let (_, w) = load_str(r#"{"browser_home": "x"}"#);
        assert!(w[0].contains("unknown setting"));
    }

    #[test]
    fn bad_values_warn_and_keep_default() {
        for bad in [r#"{"hops": "3"}"#, r#"{"notify": 1}"#, r#"{"hops": true}"#, r#"{"idle_every": [1]}"#,
                    r#"{"focus_brighten": {"dim": 1}}"#, r#"{"ignored_exit": [1.5]}"#, r#"{"font": 3}"#] {
            let (s, w) = load_str(bad);
            assert_eq!(w.len(), 1, "{bad}");
            assert!(w[0].contains("bad value"), "{w:?}");
            assert_eq!(s, defaults(), "{bad}");
        }
    }

    #[test]
    fn dicts_merge_into_default() {
        let (s, w) = load_str(r#"{"focus_brighten": {"dark": 0.1}}"#);
        assert!(w.is_empty());
        assert_eq!(s["focus_brighten"], json!({"dark": 0.1, "light": 0.0}));
    }

    #[test]
    fn ints_accepted_for_floats() {
        let (s, w) = load_str(r#"{"figure_opacity": 1}"#);
        assert!(w.is_empty());
        assert_eq!(s["figure_opacity"], json!(1));
    }

    #[test]
    fn not_an_object_warns() {
        let (s, w) = load_str("[1, 2]");
        assert!(w[0].contains("not a JSON object"));
        assert_eq!(s, defaults());
    }

    #[test]
    fn bad_json_warns() {
        let (s, w) = load_str("{oops");
        assert!(w[0].starts_with("ignored"));
        assert_eq!(s, defaults());
    }
}
