//! The command line: `magica-terminal [--crush | --note] [-e | --] [CMD ARGS…]`.


#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Overlay {
    Crush,
    Note,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Cli {
    /// Open a window: optionally with the game or notepad over its first pane, or running a command there.
    Window { overlay: Option<Overlay>, command: Option<Vec<String>> },
    /// `--crush` / `--note` typed inside a Magica pane: that pane opens it (via the escape sequence).
    InPane(Overlay),
}

/// `in_pane`: started from a shell inside Magica Terminal (`MAGICA_APP` is set).
pub fn parse(args: &[String], in_pane: bool) -> Cli {
    let mut args = args;
    let overlay = match args.first().map(String::as_str) {
        Some("--crush") => Some(Overlay::Crush),
        Some("--note") => Some(Overlay::Note),
        _ => None,
    };
    if overlay.is_some() {
        args = &args[1..];
    }
    if matches!(args.first().map(String::as_str), Some("-e" | "--")) {
        args = &args[1..];
    }
    match (overlay, args.is_empty(), in_pane) {
        (Some(o), true, true) => Cli::InPane(o),
        _ => Cli::Window { overlay, command: (!args.is_empty()).then(|| args.to_vec()) },
    }
}

/// What `--crush` / `--note` print inside a pane.
pub fn in_pane_sequence(o: Overlay) -> String {
    format!("\x1b]9973;{}\x1b\\", match o { Overlay::Crush => "crush", Overlay::Note => "note" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str], in_pane: bool) -> Cli {
        parse(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>(), in_pane)
    }

    #[test]
    fn plain() {
        assert_eq!(p(&[], false), Cli::Window { overlay: None, command: None });
        assert_eq!(p(&[], true), Cli::Window { overlay: None, command: None });
    }

    #[test]
    fn overlays() {
        assert_eq!(p(&["--crush"], false), Cli::Window { overlay: Some(Overlay::Crush), command: None });
        assert_eq!(p(&["--note"], false), Cli::Window { overlay: Some(Overlay::Note), command: None });
        assert_eq!(p(&["--note"], true), Cli::InPane(Overlay::Note));
        assert_eq!(p(&["--crush"], true), Cli::InPane(Overlay::Crush));
    }

    #[test]
    fn commands() {
        let cmd = |v: &[&str]| Some(v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(p(&["-e", "htop"], false), Cli::Window { overlay: None, command: cmd(&["htop"]) });
        assert_eq!(p(&["--", "htop"], false), Cli::Window { overlay: None, command: cmd(&["htop"]) });
        assert_eq!(p(&["htop", "-d", "5"], false), Cli::Window { overlay: None, command: cmd(&["htop", "-d", "5"]) });
        assert_eq!(p(&["-e"], false), Cli::Window { overlay: None, command: None });
    }

    #[test]
    fn in_pane_command_opens_a_window() {
        assert!(matches!(p(&["htop"], true), Cli::Window { .. }));
    }

    #[test]
    fn in_pane_sequences() {
        assert_eq!(in_pane_sequence(Overlay::Crush), "\x1b]9973;crush\x1b\\");
        assert_eq!(in_pane_sequence(Overlay::Note), "\x1b]9973;note\x1b\\");
    }
}
