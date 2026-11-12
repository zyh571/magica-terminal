//! The Tauri side: the window's commands, backed by magica-core.
use magica_core::{agents, cli::Overlay, instance, paths, pty::PtyManager, scan::DiskScan, session, settings, shell::SpawnOpts};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager, State};

struct App {
    settings: Value,
    startup: Startup,
    restore: Mutex<Option<Value>>,   // the saved session, handed out once
    ptys: PtyManager,
    scans: Mutex<HashMap<u32, DiskScan>>,
    next_scan: AtomicU32,
}

#[derive(Serialize, Clone)]
struct Startup {
    overlay: Option<Overlay>,
    command: Option<Vec<String>>,
    os: &'static str,
    home: String,
}

#[derive(Serialize)]
struct Resume {
    resume: String,
    cwd: Option<String>,
}

fn allowed(name: &str) -> Result<PathBuf, String> {
    match name {
        "note.txt" | "crush.json" | "theme" => Ok(paths::file(name)),
        _ => Err(format!("not a Magica file: {name}")),
    }
}

#[tauri::command]
fn get_settings(app: State<App>) -> Value {
    app.settings.clone()
}

#[tauri::command]
fn get_startup(app: State<App>) -> Startup {
    app.startup.clone()
}

#[tauri::command]
fn read_text(name: String) -> Result<String, String> {
    Ok(std::fs::read_to_string(allowed(&name)?).unwrap_or_default())
}

#[tauri::command]
fn write_text(name: String, text: String) -> Result<bool, String> {
    Ok(magica_core::fsio::write_file(&allowed(&name)?, &text, false))
}

#[tauri::command]
fn pty_spawn(app: State<App>, opts: SpawnOpts, on_output: Channel<InvokeResponseBody>, on_exit: Channel<i32>) -> Result<u32, String> {
    app.ptys.spawn(
        &opts,
        Box::new(move |bytes| {
            let _ = on_output.send(InvokeResponseBody::Raw(bytes));
        }),
        Box::new(move |code| {
            let _ = on_exit.send(code);
        }),
    )
}

#[tauri::command]
fn pty_write(app: State<App>, id: u32, data: String) -> Result<(), String> {
    app.ptys.write(id, data.as_bytes())
}

#[tauri::command]
fn pty_resize(app: State<App>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    app.ptys.resize(id, cols, rows)
}

#[tauri::command]
fn pty_kill(app: State<App>, id: u32) {
    app.ptys.kill(id)
}

/// The coding agent a pane is running, to start it again when the session is restored.
#[tauri::command]
fn pane_resume(app: State<App>, id: u32) -> Option<Resume> {
    let pid = app.ptys.pid(id)?;
    let procs = agents::ProcTable::snapshot();
    let sessions = dirs::home_dir()?.join(".claude").join("sessions");
    if let Some((sid, cwd)) = agents::claude_session(pid, &sessions, &procs) {
        return Some(Resume { resume: format!("claude:{sid}"), cwd });
    }
    let agent = agents::foreground_agent(app.ptys.foreground_pid(id), pid, &procs)?;
    Some(Resume { resume: agent.to_string(), cwd: None })
}

#[tauri::command]
fn load_session(app: State<App>) -> Option<Value> {
    app.restore.lock().unwrap().take()
}

#[tauri::command]
fn save_session(json: String) -> bool {
    session::save(&paths::file("session.json"), &json)
}

#[tauri::command]
fn clear_session() {
    session::clear(&paths::file("session.json"))
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn scan_new(app: State<App>, path: String) -> u32 {
    let id = app.next_scan.fetch_add(1, Ordering::Relaxed);
    app.scans.lock().unwrap().insert(id, DiskScan::new(std::path::Path::new(&path)));
    id
}

/// Go up past where the scan started; the new root, or None at the top of the disk.
#[tauri::command]
fn scan_up(app: State<App>, id: u32) -> Option<usize> {
    let scans = app.scans.lock().unwrap();
    let s = scans.get(&id)?;
    let root = s.root();
    let parent = s.path(root).parent()?.to_path_buf();
    Some(s.start_parent(&parent, root))
}

#[tauri::command]
fn scan_view(app: State<App>, id: u32, node: Option<usize>) -> Option<(magica_core::scan::NodeView, bool)> {
    let scans = app.scans.lock().unwrap();
    let s = scans.get(&id)?;
    Some((s.view(node.unwrap_or_else(|| s.root()))?, s.running()))
}

#[tauri::command]
fn scan_drop(app: State<App>, id: u32) {
    app.scans.lock().unwrap().remove(&id);
}

pub fn run(overlay: Option<Overlay>, command: Option<Vec<String>>) {
    let (settings, warnings) = settings::load(&paths::file("settings.json"));
    for w in warnings {
        eprintln!("magica-terminal: {}: {w}", paths::file("settings.json").display());
    }
    // a command or another Magica Terminal already open: start fresh, don't restore
    let restore = if command.is_none() && !instance::other_running() { session::load(&paths::file("session.json")) } else { None };
    let startup = Startup {
        overlay,
        command,
        os: if cfg!(target_os = "macos") { "mac" } else if cfg!(windows) { "windows" } else { "linux" },
        home: dirs::home_dir().map(|h| h.to_string_lossy().into_owned()).unwrap_or_default(),
    };
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            let shell_dir = app.path().resource_dir().map(|d| d.join("shell")).unwrap_or_default();
            app.manage(App {
                settings: Value::Object(settings),
                startup,
                restore: Mutex::new(restore),
                ptys: PtyManager::new(shell_dir, paths::config_dir()),
                scans: Mutex::new(HashMap::new()),
                next_scan: AtomicU32::new(1),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings, get_startup, read_text, write_text, pty_spawn, pty_write, pty_resize, pty_kill, pane_resume,
            load_session, save_session, clear_session, path_exists, scan_new, scan_up, scan_view, scan_drop
        ])
        .run(tauri::generate_context!())
        .expect("error while running Magica Terminal");
}
