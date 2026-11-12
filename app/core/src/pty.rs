//! Panes' pseudo-terminals: start a shell, pass its output on in chunks, write to it, resize, kill.
use crate::shell::{command_for, default_shell, fallback_shell, ShellKind, SpawnOpts};
use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// Largest piece of output handed on at once.
pub const CHUNK: usize = 65536;

pub type OnOutput = Box<dyn FnMut(Vec<u8>) + Send>;
pub type OnExit = Box<dyn FnOnce(i32) + Send>;

struct Pane {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
}

/// All of a window's panes, by id.
pub struct PtyManager {
    panes: Arc<Mutex<HashMap<u32, Pane>>>,
    next: AtomicU32,
    shell_dir: PathBuf,
    config_dir: PathBuf,
}

impl PtyManager {
    pub fn new(shell_dir: PathBuf, config_dir: PathBuf) -> Self {
        Self { panes: Default::default(), next: AtomicU32::new(1), shell_dir, config_dir }
    }

    /// Start a pane: the user's shell (or `opts.command`). If the shell won't start, says so in the pane and starts the
    /// fallback shell. Output goes to `on_output` in pieces of at most `CHUNK` bytes, then the exit code to `on_exit`.
    pub fn spawn(&self, opts: &SpawnOpts, mut on_output: OnOutput, on_exit: OnExit) -> Result<u32, String> {
        let pair = native_pty_system()
            .openpty(PtySize { rows: opts.rows.max(1), cols: opts.cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let shell = default_shell();
        let child = match pair.slave.spawn_command(command_for(&shell, opts, &self.shell_dir, &self.config_dir)) {
            Ok(c) => c,
            Err(e) if opts.command.is_none() => {
                on_output(format!("magica: couldn't start {}: {e}\r\n", shell.path().display()).into_bytes());
                let fb: ShellKind = fallback_shell();
                pair.slave
                    .spawn_command(command_for(&fb, opts, &self.shell_dir, &self.config_dir))
                    .map_err(|e| e.to_string())?
            }
            Err(e) => return Err(e.to_string()),
        };
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let pid = child.process_id();
        let killer = child.clone_killer();
        self.panes.lock().unwrap().insert(id, Pane { master: pair.master, writer, killer, pid });

        let (eof_tx, eof_rx) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; CHUNK];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_output(buf[..n].to_vec()),
                }
            }
            let _ = eof_tx.send(());
        });
        let panes = self.panes.clone();
        let mut child = child;
        std::thread::spawn(move || {
            let code = child.wait().map(|s| s.exit_code() as i32).unwrap_or(-1);
            // let the last output through (ConPTY never reports the end while the pane is open)
            let _ = eof_rx.recv_timeout(Duration::from_millis(300));
            panes.lock().unwrap().remove(&id);
            on_exit(code);
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let mut panes = self.panes.lock().unwrap();
        let p = panes.get_mut(&id).ok_or("no such pane")?;
        p.writer.write_all(data).and_then(|_| p.writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let panes = self.panes.lock().unwrap();
        let p = panes.get(&id).ok_or("no such pane")?;
        p.master
            .resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self, id: u32) {
        if let Some(p) = self.panes.lock().unwrap().get_mut(&id) {
            let _ = p.killer.kill();
        }
    }

    /// The pane's shell's process id.
    pub fn pid(&self, id: u32) -> Option<u32> {
        self.panes.lock().unwrap().get(&id).and_then(|p| p.pid)
    }

    /// The process group in the foreground of the pane's terminal (Unix only).
    pub fn foreground_pid(&self, id: u32) -> Option<u32> {
        #[cfg(unix)]
        {
            self.panes.lock().unwrap().get(&id).and_then(|p| p.master.process_group_leader()).map(|p| p as u32)
        }
        #[cfg(not(unix))]
        {
            let _ = id;
            None
        }
    }
}
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn spawn(m: &PtyManager, argv: &[&str]) -> (u32, mpsc::Receiver<Vec<u8>>, mpsc::Receiver<i32>) {
        let (otx, orx) = mpsc::channel();
        let (etx, erx) = mpsc::channel();
        let opts = SpawnOpts {
            character: "madoka".into(),
            command: Some(argv.iter().map(|s| s.to_string()).collect()),
            cols: 80,
            rows: 24,
            ..Default::default()
        };
        let id = m
            .spawn(&opts, Box::new(move |b| { let _ = otx.send(b); }), Box::new(move |c| { let _ = etx.send(c); }))
            .unwrap();
        (id, orx, erx)
    }

    fn collect(rx: &mpsc::Receiver<Vec<u8>>, until: impl Fn(&[u8]) -> bool) -> Vec<u8> {
        let mut all = Vec::new();
        while !until(&all) {
            match rx.recv_timeout(Duration::from_secs(10)) {
                Ok(b) => all.extend(b),
                Err(_) => break,
            }
        }
        all
    }

    fn manager() -> PtyManager {
        PtyManager::new("/res/shell".into(), "/cfg".into())
    }

    #[test]
    fn spawn_echo_reaches_channel() {
        let m = manager();
        let (_, out, exit) = spawn(&m, &["sh", "-c", "printf hi"]);
        let got = collect(&out, |b| b.windows(2).any(|w| w == b"hi"));
        assert!(String::from_utf8_lossy(&got).contains("hi"));
        assert_eq!(exit.recv_timeout(Duration::from_secs(10)).unwrap(), 0);
    }

    #[test]
    fn exit_code_is_passed_on() {
        let m = manager();
        let (_, _out, exit) = spawn(&m, &["sh", "-c", "exit 3"]);
        assert_eq!(exit.recv_timeout(Duration::from_secs(10)).unwrap(), 3);
    }

    #[test]
    fn write_reaches_child() {
        let m = manager();
        let (id, out, _) = spawn(&m, &["cat"]);
        m.write(id, b"abc\n").unwrap();
        let got = collect(&out, |b| String::from_utf8_lossy(b).matches("abc").count() >= 2);
        assert!(String::from_utf8_lossy(&got).matches("abc").count() >= 2); // echo + cat's copy
        m.kill(id);
    }

    #[test]
    fn resize_changes_size() {
        let m = manager();
        let (id, out, _) = spawn(&m, &["sh", "-c", "sleep 0.5; stty size"]);
        m.resize(id, 100, 30).unwrap();
        let got = collect(&out, |b| String::from_utf8_lossy(b).contains("30 100"));
        assert!(String::from_utf8_lossy(&got).contains("30 100"));
    }

    #[test]
    fn big_output_is_chunked() {
        let m = manager();
        let (otx, orx) = mpsc::channel::<usize>();
        let (etx, erx) = mpsc::channel();
        let opts = SpawnOpts {
            command: Some(vec!["sh".into(), "-c".into(), "head -c 5000000 /dev/zero | tr '\\0' a".into()]),
            cols: 80, rows: 24, ..Default::default()
        };
        m.spawn(&opts, Box::new(move |b| { let _ = otx.send(b.len()); }), Box::new(move |c| { let _ = etx.send(c); })).unwrap();
        erx.recv_timeout(Duration::from_secs(20)).unwrap();
        let sizes: Vec<usize> = orx.try_iter().collect();
        assert!(sizes.iter().sum::<usize>() >= 5_000_000);
        assert!(sizes.iter().all(|&s| s <= 65536));
    }

    #[test]
    fn pid_is_known() {
        let m = manager();
        let (id, _out, _) = spawn(&m, &["sleep", "5"]);
        assert!(m.pid(id).is_some());
        m.kill(id);
    }
}
