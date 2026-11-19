// Magica Terminal. `--crush` / `--note` typed inside one of its panes just tell that pane (and exit); anything else
// opens a window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use magica_core::cli::{in_pane_sequence, parse, Cli};
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let in_pane = std::env::var("MAGICA_APP").is_ok_and(|v| v == "tauri");
    match parse(&args, in_pane) {
        Cli::InPane(o) => tell_pane(in_pane_sequence(o).as_bytes()),
        Cli::Window { overlay, command } => magica_terminal::run(overlay, command),
        Cli::Uninstall { purge } => match magica_core::uninstall::run(purge) {
            Ok(message) => tell_pane(message.as_bytes()),
            Err(error) => {
                tell_pane(format!("could not uninstall Magica Terminal: {error}\n").as_bytes());
                std::process::exit(1);
            }
        },
    }
}

#[cfg(not(windows))]
fn tell_pane(seq: &[u8]) {
    let mut out = std::io::stdout();
    let _ = out.write_all(seq);
    let _ = out.flush();
}

/// On Windows the release build is a GUI program with no console of its own, so stdout goes nowhere: attach to the
/// pane's console (the shell that started it) and write there, with escape sequences passed on.
#[cfg(windows)]
fn tell_pane(seq: &[u8]) {
    use std::os::windows::io::AsRawHandle;
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;
    extern "system" {
        fn AttachConsole(pid: u32) -> i32;
        fn GetConsoleMode(handle: *mut std::ffi::c_void, mode: *mut u32) -> i32;
        fn SetConsoleMode(handle: *mut std::ffi::c_void, mode: u32) -> i32;
    }
    unsafe { AttachConsole(ATTACH_PARENT_PROCESS) };   // (fails harmlessly when there's a console already: debug builds)
    let Ok(mut out) = std::fs::OpenOptions::new().write(true).open("CONOUT$") else { return };
    let h = out.as_raw_handle();
    let mut mode = 0;
    unsafe {
        if GetConsoleMode(h, &mut mode) != 0 {
            SetConsoleMode(h, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        }
    }
    let _ = out.write_all(seq);
    let _ = out.flush();
}
