#![recursion_limit = "256"]
//! Everything Magica Terminal does that isn't drawing: files, settings, shells, sessions, the disk scan.
//! Kept free of Tauri so it builds and tests anywhere.
pub mod agents;
pub mod cli;
pub mod fsio;
pub mod instance;
pub mod paths;
pub mod pty;
pub mod scan;
pub mod session;
pub mod settings;
pub mod shell;
