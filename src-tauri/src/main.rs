// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Anchors the startup clock as early as the process can reach, so the
    // measurement includes Tauri initialisation rather than starting after it.
    dcmd_lib::trace_startup("main() entered");
    dcmd_lib::run()
}
