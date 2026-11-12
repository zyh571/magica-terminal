//! Whether another Magica Terminal is running (then a new one starts fresh instead of restoring the session).
use crate::paths::BIN_NAME;

/// Is a process named `name` (or `name.exe`) running, other than `me`?
pub fn other_running_in(procs: impl Iterator<Item = (u32, String)>, me: u32, name: &str) -> bool {
    let exe = format!("{name}.exe");
    procs.into_iter().any(|(pid, n)| pid != me && (n == name || n.eq_ignore_ascii_case(&exe)))
}

/// Is another Magica Terminal running?
pub fn other_running() -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let procs = sys.processes().iter().map(|(p, pr)| (p.as_u32(), pr.name().to_string_lossy().into_owned()));
    other_running_in(procs, std::process::id(), BIN_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_another_process_by_name() {
        let names = ["bash", "magica-dev", "magica-dev"];
        assert!(other_running_in(names.iter().enumerate().map(|(i, n)| (i as u32, n.to_string())), 1, "magica-dev"));
        assert!(!other_running_in(names.iter().enumerate().map(|(i, n)| (i as u32, n.to_string())).take(2), 1, "magica-dev"));
        assert!(other_running_in([(5, "magica-dev.exe".to_string())].into_iter(), 1, "magica-dev"));
    }
}
