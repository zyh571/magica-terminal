//! Which coding agent (Claude Code, Codex, opencode) a pane is running, so a restored pane can start it again.
use std::collections::HashMap;
use std::path::Path;

/// Each agent's subcommands that aren't its interactive app (those panes come back as text).
const NOT_INTERACTIVE: &[(&str, &[&str])] = &[
    ("codex", &["exec", "e", "review", "login", "logout", "mcp", "mcp-server", "app-server", "app", "completion",
                "sandbox", "debug", "apply", "a", "cloud", "features", "help"]),
    ("opencode", &["run", "serve", "web", "session", "export", "import", "auth", "models", "mcp", "stats", "upgrade",
                   "uninstall", "github", "acp", "agent", "debug", "pr", "help"]),
];

/// The processes: parent and command line of each, by pid.
#[derive(Default)]
pub struct ProcTable {
    procs: HashMap<u32, (u32, Vec<String>)>,
}

impl ProcTable {
    pub fn insert(&mut self, pid: u32, ppid: u32, argv: &[&str]) {
        self.procs.insert(pid, (ppid, argv.iter().map(|s| s.to_string()).collect()));
    }

    /// Every process running now.
    pub fn snapshot() -> Self {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always));
        let procs = sys
            .processes()
            .iter()
            .map(|(pid, p)| {
                let argv = p.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect();
                (pid.as_u32(), (p.parent().map(|q| q.as_u32()).unwrap_or(0), argv))
            })
            .collect();
        Self { procs }
    }

    pub fn argv(&self, pid: u32) -> Option<&[String]> {
        self.procs.get(&pid).map(|(_, a)| a.as_slice())
    }

    /// Every process under `pid` (children, theirs, …), nearest first.
    pub fn descendants(&self, pid: u32) -> Vec<u32> {
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        for (&p, (pp, _)) in &self.procs {
            if p != *pp {
                children.entry(*pp).or_default().push(p);
            }
        }
        for v in children.values_mut() {
            v.sort();
        }
        let (mut found, mut todo) = (Vec::new(), vec![pid]);
        let mut i = 0;
        while i < todo.len() {
            for &k in children.get(&todo[i]).map(|v| v.as_slice()).unwrap_or(&[]) {
                if !found.contains(&k) {
                    found.push(k);
                    todo.push(k);
                }
            }
            i += 1;
        }
        found
    }
}

fn base(path: &str) -> String {
    let name = path.rsplit(['/', '\\']).next().unwrap_or("");
    let lower = name.to_lowercase();
    let mut n = lower.as_str();
    for ext in [".exe", ".cmd", ".ps1", ".bat", ".cjs", ".mjs", ".js"] {
        if let Some(stripped) = n.strip_suffix(ext) {
            n = stripped;
            break;
        }
    }
    n.to_string()
}

/// "codex" / "opencode" if argv is that agent's interactive app (not one of its other subcommands).
pub fn agent_in(argv: &[String]) -> Option<&'static str> {
    let mut argv = argv;
    if argv.first().is_some_and(|a| matches!(base(a).as_str(), "node" | "bun" | "deno")) {
        argv = &argv[1..];   // an npm install: node …/bin/codex.js
    }
    let name = base(argv.first()?);
    let (agent, others) = NOT_INTERACTIVE.iter().find(|(n, _)| *n == name)?;
    let first_word = argv[1..].iter().find(|a| !a.starts_with('-'));
    match first_word {
        Some(w) if others.contains(&w.as_str()) => None,
        _ => Some(agent),
    }
}

fn is_session_id(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.iter().map(|p| p.len()).eq([8, 4, 4, 4, 12])
        && parts.iter().all(|p| p.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

/// (session id, folder) of a Claude Code running under `shell_pid`, from its `<pid>.json` in Claude's sessions folder.
pub fn claude_session(shell_pid: u32, sessions_dir: &Path, procs: &ProcTable) -> Option<(String, Option<String>)> {
    procs.descendants(shell_pid).into_iter().find_map(|p| {
        let text = std::fs::read_to_string(sessions_dir.join(format!("{p}.json"))).ok()?;
        let info: serde_json::Value = serde_json::from_str(&text).ok()?;
        let sid = info.get("sessionId")?.as_str()?;
        if info.get("pid")?.as_u64()? != p as u64 || !is_session_id(sid) {
            return None;
        }
        Some((sid.to_string(), info.get("cwd").and_then(|c| c.as_str()).map(String::from)))
    })
}

/// The coding agent in the foreground of a pane: the foreground process group's leader where the OS has one (Unix),
/// else (Windows) the first agent found under the shell.
pub fn foreground_agent(fg_pid: Option<u32>, shell_pid: u32, procs: &ProcTable) -> Option<&'static str> {
    match fg_pid {
        Some(p) if p == shell_pid || p == 0 => None,
        Some(p) => agent_in(procs.argv(p)?),
        None => procs.descendants(shell_pid).into_iter().find_map(|p| agent_in(procs.argv(p)?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SID: &str = "0b5e7f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

    fn table() -> ProcTable {
        // 10 shell → 11 node(claude) → 12 helper;  10 → 13 codex (another job)
        let mut t = ProcTable::default();
        t.insert(10, 1, &["bash"]);
        t.insert(11, 10, &["node", "/usr/lib/claude/cli.js"]);
        t.insert(12, 11, &["rg"]);
        t.insert(13, 10, &["/home/u/.local/bin/codex", "--model", "x"]);
        t.insert(20, 1, &["bash"]);
        t
    }

    fn sessions(pid: u32, sid: &str) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join(format!("{pid}.json")),
            serde_json::json!({"pid": pid, "sessionId": sid, "cwd": "/somewhere"}).to_string(),
        )
        .unwrap();
        d
    }

    #[test]
    fn descendants_of_a_shell() {
        let mut d = table().descendants(10);
        d.sort();
        assert_eq!(d, [11, 12, 13]);
        assert!(table().descendants(20).is_empty());
    }

    #[test]
    fn claude_found() {
        let d = sessions(11, SID);
        assert_eq!(claude_session(10, d.path(), &table()), Some((SID.to_string(), Some("/somewhere".to_string()))));
    }

    #[test]
    fn claude_none() {
        let d = sessions(11, SID);
        assert_eq!(claude_session(20, d.path(), &table()), None); // not under this shell
        assert_eq!(claude_session(10, Path::new("/nonexistent"), &table()), None);
    }

    #[test]
    fn claude_bad_id() {
        let d = sessions(11, "x; rm -rf ~");
        assert_eq!(claude_session(10, d.path(), &table()), None);
    }

    #[test]
    fn claude_pid_must_match() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("11.json"), serde_json::json!({"pid": 99, "sessionId": SID}).to_string()).unwrap();
        assert_eq!(claude_session(10, d.path(), &table()), None);
    }

    #[test]
    fn foreground_by_process_group() {
        assert_eq!(foreground_agent(Some(13), 10, &table()), Some("codex"));
        assert_eq!(foreground_agent(Some(12), 10, &table()), None);
        assert_eq!(foreground_agent(Some(10), 10, &table()), None); // the shell itself
    }

    #[test]
    fn foreground_without_process_groups_looks_below_the_shell() {
        assert_eq!(foreground_agent(None, 10, &table()), Some("codex"));
        assert_eq!(foreground_agent(None, 20, &table()), None);
    }

    #[test]
    fn argv() {
        let a = |v: &[&str]| agent_in(&v.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(a(&["codex"]), Some("codex"));
        assert_eq!(a(&["/home/u/.local/bin/codex", "--model", "x", "fix it"]), Some("codex"));
        assert_eq!(a(&["codex", "resume", "--last"]), Some("codex"));
        assert_eq!(a(&["node", "/usr/lib/node_modules/@openai/codex/bin/codex.js"]), Some("codex"));
        assert_eq!(a(&["C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd"]), Some("codex"));
        assert_eq!(a(&["opencode.exe", "-c"]), Some("opencode"));
        assert_eq!(a(&["opencode", "-c"]), Some("opencode"));
        assert_eq!(a(&["codex", "exec", "do it"]), None);
        assert_eq!(a(&["opencode", "serve"]), None);
        assert_eq!(a(&["node", "server.js"]), None);
        assert_eq!(a(&[]), None);
    }

    #[test]
    fn real_processes() {
        let me = std::process::id();
        let t = ProcTable::snapshot();
        let mut child = std::process::Command::new("sleep").arg("5").spawn().unwrap();
        let t2 = ProcTable::snapshot();
        assert!(t2.descendants(me).contains(&child.id()));
        let _ = t;
        child.kill().unwrap();
        child.wait().unwrap();
    }
}
