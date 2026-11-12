//! Which shell a pane runs, and how it's started with Magica's integration script loaded.
use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};

/// What the window asks for when it opens a pane.
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(default)]
pub struct SpawnOpts {
    /// Folder to start in (home if missing or gone).
    pub cwd: Option<String>,
    /// The pane's character (`MAGICA_CHAR`).
    pub character: String,
    /// Run this instead of a shell (`magica-terminal -e …`); no integration.
    pub command: Option<Vec<String>>,
    /// A coding agent to start again at the first prompt (`MAGICA_RESUME`).
    pub resume: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// The shells Magica integrates with, and anything else (started plainly).
#[derive(Clone, Debug)]
pub enum ShellKind {
    Bash(PathBuf),
    Zsh(PathBuf),
    Pwsh(PathBuf),
    Other(PathBuf),
}

impl ShellKind {
    pub fn from_path(p: PathBuf) -> Self {
        let name = p.to_string_lossy().rsplit(['/', '\\']).next().unwrap_or("").to_lowercase();
        let stem = name.strip_suffix(".exe").unwrap_or(&name).to_string();
        match stem.as_str() {
            "bash" => Self::Bash(p),
            "zsh" => Self::Zsh(p),
            "pwsh" | "powershell" => Self::Pwsh(p),
            _ => Self::Other(p),
        }
    }

    pub fn path(&self) -> &Path {
        match self {
            Self::Bash(p) | Self::Zsh(p) | Self::Pwsh(p) | Self::Other(p) => p,
        }
    }
}

/// `$SHELL` if it exists, else `/bin/sh`.
#[cfg(unix)]
pub fn shell_from(var: Option<PathBuf>) -> ShellKind {
    match var {
        Some(p) if p.is_file() => ShellKind::from_path(p),
        _ => ShellKind::from_path("/bin/sh".into()),
    }
}

/// The user's shell: `$SHELL` on Linux and macOS; on Windows PowerShell 7 (`pwsh.exe`) if it's on the PATH, else
/// Windows PowerShell.
pub fn default_shell() -> ShellKind {
    #[cfg(unix)]
    {
        shell_from(std::env::var_os("SHELL").map(PathBuf::from))
    }
    #[cfg(windows)]
    {
        let on_path = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).map(|d| d.join("pwsh.exe")).find(|f| f.is_file()))
            .flatten();
        ShellKind::from_path(on_path.unwrap_or_else(|| "powershell.exe".into()))
    }
}

/// The fallback when the user's shell won't start.
pub fn fallback_shell() -> ShellKind {
    #[cfg(unix)]
    {
        ShellKind::from_path("/bin/sh".into())
    }
    #[cfg(windows)]
    {
        ShellKind::from_path("powershell.exe".into())
    }
}

/// How to start `shell` for a pane: with Magica's script loaded after the user's own startup files, the `MAGICA_*`
/// variables set, in `opts.cwd`. `opts.command` is run as it is instead.
pub fn command_for(shell: &ShellKind, opts: &SpawnOpts, shell_dir: &Path, config_dir: &Path) -> CommandBuilder {
    let login = cfg!(target_os = "macos");   // macOS terminals start login shells (zsh)
    let mut c = match (&opts.command, shell) {
        (Some(argv), _) if !argv.is_empty() => CommandBuilder::from_argv(argv.iter().map(Into::into).collect()),
        (_, ShellKind::Bash(p)) => {
            // (not -l: a login bash ignores --rcfile; on macOS bash/rc reads the login profile itself)
            let mut c = CommandBuilder::new(p);
            c.arg("--rcfile");
            c.arg(shell_dir.join("bash").join("rc"));
            c.arg("-i");
            c
        }
        (_, ShellKind::Zsh(p)) => {
            let mut c = CommandBuilder::new(p);
            let user = std::env::var_os("ZDOTDIR").or_else(|| dirs::home_dir().map(Into::into)).unwrap_or_default();
            c.env("MAGICA_USER_ZDOTDIR", user);
            c.env("ZDOTDIR", shell_dir.join("zsh"));
            if login {
                c.arg("-l");
            }
            c.arg("-i");
            c
        }
        (_, ShellKind::Pwsh(p)) => {
            let mut c = CommandBuilder::new(p);
            let script = shell_dir.join("magica.ps1").to_string_lossy().replace('\'', "''");
            c.args(["-NoLogo", "-NoExit", "-Command"]);
            c.arg(format!(". '{script}'"));
            c
        }
        (_, ShellKind::Other(p)) => CommandBuilder::new(p),
    };
    c.env("MAGICA_APP", "tauri");
    c.env("MAGICA_CHAR", &opts.character);
    c.env("MAGICA_SHELL_DIR", shell_dir);
    c.env("MAGICA_CONFIG", config_dir);
    c.env("TERM", "xterm-256color");
    c.env("COLORTERM", "truecolor");
    c.env("TERM_PROGRAM", "magica");
    match &opts.resume {
        Some(r) => c.env("MAGICA_RESUME", r),
        None => c.env_remove("MAGICA_RESUME"),
    }
    let home = dirs::home_dir().unwrap_or_else(|| ".".into());
    let cwd = opts.cwd.as_ref().map(PathBuf::from).filter(|p| p.is_dir()).unwrap_or(home);
    c.cwd(cwd);
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> SpawnOpts {
        SpawnOpts { character: "homura".into(), cwd: Some("/tmp".into()), ..Default::default() }
    }
    fn argv(c: &CommandBuilder) -> Vec<String> {
        c.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect()
    }
    fn env(c: &CommandBuilder, k: &str) -> Option<String> {
        c.get_env(k).map(|v| v.to_string_lossy().into_owned())
    }
    const DIR: &str = "/res/shell";

    #[test]
    fn kind_from_path() {
        assert!(matches!(ShellKind::from_path("/usr/bin/bash".into()), ShellKind::Bash(_)));
        assert!(matches!(ShellKind::from_path("/bin/zsh".into()), ShellKind::Zsh(_)));
        assert!(matches!(ShellKind::from_path("C:\\x\\pwsh.exe".into()), ShellKind::Pwsh(_)));
        assert!(matches!(ShellKind::from_path("powershell.exe".into()), ShellKind::Pwsh(_)));
        assert!(matches!(ShellKind::from_path("/usr/bin/fish".into()), ShellKind::Other(_)));
    }

    #[test]
    fn bash_argv() {
        let c = command_for(&ShellKind::Bash("/bin/bash".into()), &opts(), Path::new(DIR), Path::new("/cfg"));
        let a = argv(&c);
        assert_eq!(a[0], "/bin/bash");
        assert!(a.windows(2).any(|w| w[0] == "--rcfile" && w[1] == format!("{DIR}/bash/rc")), "{a:?}");
        assert!(a.contains(&"-i".to_string()));
        assert_eq!(env(&c, "MAGICA_APP").as_deref(), Some("tauri"));
        assert_eq!(env(&c, "MAGICA_CHAR").as_deref(), Some("homura"));
        assert_eq!(env(&c, "MAGICA_SHELL_DIR").as_deref(), Some(DIR));
        assert_eq!(env(&c, "MAGICA_CONFIG").as_deref(), Some("/cfg"));
        assert_eq!(env(&c, "TERM").as_deref(), Some("xterm-256color"));
        assert_eq!(env(&c, "MAGICA_RESUME"), None);
        assert_eq!(c.get_cwd().map(|p| p.to_string_lossy().into_owned()).as_deref(), Some("/tmp"));
    }

    #[test]
    fn zsh_env_has_zdotdir() {
        let c = command_for(&ShellKind::Zsh("/bin/zsh".into()), &opts(), Path::new(DIR), Path::new("/cfg"));
        assert_eq!(env(&c, "ZDOTDIR").as_deref(), Some(&*format!("{DIR}/zsh")));
        assert!(env(&c, "MAGICA_USER_ZDOTDIR").is_some());
        assert!(argv(&c).contains(&"-i".to_string()));
    }

    #[test]
    fn pwsh_argv_dot_sources_script() {
        let c = command_for(&ShellKind::Pwsh("pwsh".into()), &opts(), Path::new(DIR), Path::new("/cfg"));
        let a = argv(&c);
        assert!(a.contains(&"-NoExit".to_string()));
        assert!(a.last().unwrap().contains("magica.ps1"), "{a:?}");
        assert!(a.last().unwrap().starts_with(". '"), "{a:?}");
    }

    #[test]
    fn resume_sets_env() {
        let o = SpawnOpts { resume: Some("codex".into()), ..opts() };
        let c = command_for(&ShellKind::Bash("/bin/bash".into()), &o, Path::new(DIR), Path::new("/cfg"));
        assert_eq!(env(&c, "MAGICA_RESUME").as_deref(), Some("codex"));
    }

    #[test]
    fn command_runs_directly() {
        let o = SpawnOpts { command: Some(vec!["htop".into(), "-d".into(), "5".into()]), ..opts() };
        let c = command_for(&ShellKind::Bash("/bin/bash".into()), &o, Path::new(DIR), Path::new("/cfg"));
        assert_eq!(argv(&c), ["htop", "-d", "5"]);
    }

    #[cfg(unix)]
    #[test]
    fn missing_shell_falls_back() {
        assert_eq!(shell_from(Some("/nonexistent/shell".into())).path(), Path::new("/bin/sh"));
        assert_eq!(shell_from(None).path(), Path::new("/bin/sh"));
        assert_eq!(shell_from(Some("/bin/sh".into())).path(), Path::new("/bin/sh"));
    }
}
