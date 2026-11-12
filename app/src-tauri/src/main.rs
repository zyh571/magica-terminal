// Magica Terminal. `--crush` / `--note` typed inside one of its panes just tell that pane (and exit); anything else
// opens a window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use magica_core::cli::{in_pane_sequence, parse, Cli};
use std::io::Write;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let in_pane = std::env::var("MAGICA_APP").is_ok_and(|v| v == "tauri");
    match parse(&args, in_pane) {
        Cli::InPane(o) => {
            let mut out = std::io::stdout();
            let _ = out.write_all(in_pane_sequence(o).as_bytes());
            let _ = out.flush();
        }
        Cli::Window { overlay, command } => magica_terminal::run(overlay, command),
    }
}
