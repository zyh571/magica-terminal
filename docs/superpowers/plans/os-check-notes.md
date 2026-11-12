# Cross-OS compile checks from Linux

- `magica-core` (all Rust logic: PTYs, shells, session, agents, scan, settings, CLI) compiles for
  `x86_64-pc-windows-msvc` and `aarch64-apple-darwin` (`cargo check --target … -p magica-core --all-targets`).
- The Tauri crate (`app/src-tauri`) can't be checked for those targets from Linux: Windows needs `llvm-rc` (the
  resource compiler `tauri-winres` uses) and macOS needs Apple's toolchain (`objc2-exception-helper` builds C with
  `-arch`). Its code is the same on every OS (no `cfg`s), so the first build on each machine is the check.
